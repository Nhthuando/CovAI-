import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { containedPath } from './fullSystemConfig.service.js';
import { ServiceError } from '../utils/serviceError.js';
import semver from 'semver';
import {isWorkspaceMember} from '../utils/projectWorkspace.js';

export const runtimeIgnoredDirectories = new Set(['node_modules','.git','.agents','.codex','.covai-temp','.covai-system-test','.covai-collaboration','test-results','coverage','dist','build','.next','.nuxt','.output','.svelte-kit','.turbo','.parcel-cache','.cache','.vite']);
const frontendTools = ['vite','next','react-scripts','@vue/cli-service','astro','nuxt','@sveltejs/kit','@angular/cli','webpack-dev-server','parcel'];
const locks = {npm:['npm-shrinkwrap.json','package-lock.json'],pnpm:['pnpm-lock.yaml'],yarn:['yarn.lock'],bun:['bun.lock','bun.lockb']};
export const readRuntimePackage = directory => {
    try { const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));if(!pkg||Array.isArray(pkg)||typeof pkg!=='object')throw new Error();return pkg; }
    catch { throw new ServiceError('Application package.json is missing or invalid',422); }
};
export const scanRuntimePackages = root => {
    const result=[];
    if (!fs.existsSync(root)) return result;
    let visited=0;
    const visit=(directory,depth)=>{
        if (depth>8 || ++visited>2000) throw new ServiceError('Application discovery exceeds the supported repository scan budget',422);
        if (fs.existsSync(path.join(directory,'package.json'))) {
            try { result.push({directory,pkg:readRuntimePackage(directory),relative:path.relative(root,directory).replaceAll('\\','/') || '.'}); }
            catch (error) { if(directory===root) throw error; }
        }
        for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || runtimeIgnoredDirectories.has(entry.name) || ['.yarn','vendor'].includes(entry.name)) continue;
            visit(containedPath(root,path.relative(root,path.join(directory,entry.name))),depth+1);
        }
    };
    visit(root,0);return result;
};
export const selectFrontendPackage = ({rootDir,testFiles=[]}) => {
    const packages=scanRuntimePackages(rootDir);
    const frontend=packages.filter(({pkg})=>frontendTools.some(tool=>({...pkg.dependencies,...pkg.devDependencies})[tool])
        || Object.values(pkg.scripts || {}).some(script=>typeof script==='string' && /\b(vite|next|react-scripts|vue-cli-service|astro|nuxt|ng serve|webpack serve|parcel)\b/.test(script)));
    if (frontend.length===1) return frontend[0].directory;
    if (frontend.length>1) {
        const owned=frontend.filter(item=>testFiles.length && testFiles.every(file=>file.startsWith(item.relative+'/')));
        if(owned.length===1) return owned[0].directory;
        throw new ServiceError(`Multiple frontend applications were found (${frontend.map(item=>item.relative).join(', ')}). Select tests from one application or configure its frontend directory.`,422);
    }
    const conventional=packages.filter(item=>['client','frontend','web','ui','app'].includes(item.relative));
    if(conventional.length===1)return conventional[0].directory;
    if(conventional.length>1)throw new ServiceError('Application package is ambiguous; configure the frontend directory',422);
    const runnable=packages.filter(({pkg})=>['dev','start','preview','serve'].some(name=>typeof pkg.scripts?.[name]==='string'));
    if(runnable.length===1)return runnable[0].directory;
    if(packages.length===1)return packages[0].directory;
    return null;
};
export const resolvePackageRuntime = ({directory,repositoryRoot=directory}) => {
    directory=containedPath(repositoryRoot,path.relative(repositoryRoot,directory));
    const pkg=readRuntimePackage(directory);
    let installRoot=directory;
    for(let parent=path.dirname(directory);parent!==path.dirname(repositoryRoot);parent=path.dirname(parent)) {
        const relative=path.relative(repositoryRoot,parent);
        if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))break;
        if(fs.existsSync(path.join(parent,'package.json'))) {
            const parentPkg=readRuntimePackage(parent);
            if(isWorkspaceMember(parent,parentPkg,path.relative(parent,directory).replaceAll('\\','/')))installRoot=parent;
        }
        if(parent===repositoryRoot)break;
    }
    const controlling=readRuntimePackage(installRoot);
    for(const metadata of [controlling,pkg]) {
        const range=metadata.engines?.node;
        if(typeof range==='string' && (!semver.validRange(range)||!semver.satisfies(process.versions.node,range))) {
            const error=new ServiceError(`This application requires Node.js ${range}; the execution worker uses ${process.versions.node}. Configure a worker with a compatible Node.js runtime before running this project.`,422);
            error.code='AUT_NODE_VERSION_UNSUPPORTED';throw error;
        }
    }
    for(const item of scanRuntimePackages(installRoot))for(const specification of Object.values({...item.pkg.dependencies,...item.pkg.devDependencies,...item.pkg.optionalDependencies})) {
        if(typeof specification!=='string'||! /^(file|link):/.test(specification))continue;
        let target;
        try {target=decodeURIComponent(specification.replace(/^(file|link):/,''));}catch{throw new ServiceError('Invalid local dependency path in package.json',422);}
        containedPath(repositoryRoot,path.relative(repositoryRoot,path.resolve(item.directory,target)));
    }
    const declared=controlling.packageManager || (installRoot===directory ? pkg.packageManager : null);
    const managerMatch=declared?.match(/^(npm|pnpm|yarn|bun)@(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\+sha\d+\.[a-fA-F0-9]+)?$/);
    if(declared&&!managerMatch)throw new ServiceError('packageManager must identify npm, pnpm, yarn or bun with an exact version',422);
    const detected=Object.keys(locks).filter(name=>locks[name].some(file=>fs.existsSync(path.join(installRoot,file)))
        || name==='pnpm'&&fs.existsSync(path.join(installRoot,'pnpm-workspace.yaml'))
        || name==='yarn'&&fs.existsSync(path.join(installRoot,'.yarnrc.yml')));
    if(!managerMatch&&detected.length>1)throw new ServiceError('Conflicting package-manager lockfiles; set packageManager in package.json',422);
    const manager=managerMatch?.[1] || detected[0] || 'npm',version=managerMatch?.[2];
    const lockfile=locks[manager].find(file=>fs.existsSync(path.join(installRoot,file)));
    const yarnModern=manager==='yarn'&&(version ? Number(version.split('.')[0])>=2 : fs.existsSync(path.join(installRoot,'.yarnrc.yml')));
    // A pinned CLI runs through npm's tool cache, without any global install.
    const toolPackage=manager==='yarn'&&yarnModern?'@yarnpkg/cli-dist':manager;
    const command=version ? `npx --yes --package=${toolPackage}@${version} -- ${manager}` : manager;
    const flags=manager==='npm'?'--include=dev --include=optional --prefer-offline --legacy-peer-deps --no-audit --no-fund --progress=false'
        : manager==='pnpm'?'--prod=false' : '';
    const install=manager==='npm'?`${command} ${lockfile?'ci':'install'} ${flags}`
        :manager==='pnpm'?`${command} install ${lockfile?'--frozen-lockfile':'--no-frozen-lockfile'} ${flags}`
        :manager==='yarn'?`${command} install ${lockfile?(yarnModern?'--immutable':'--frozen-lockfile'):''}`.trim()
        :`${command} install${lockfile?' --frozen-lockfile':''}`;
    return {directory,repositoryRoot,installRoot,pkg,manager,version,command,lockfile,install,
        repairInstall:manager==='npm'&&lockfile?`${command} install ${flags}`:null,
        env:{NODE_ENV:'development',NODE_PATH:'',npm_config_production:'false',...(yarnModern?{YARN_NODE_LINKER:'node-modules',YARN_ENABLE_IMMUTABLE_INSTALLS:lockfile?'true':'false'}:{})}};
};
export const runtimeDependencyFingerprint = (root, {includeLocks=true} = {}) => {
    const files=[];
    for(const item of scanRuntimePackages(root))for(const name of ['package.json',...(includeLocks?Object.values(locks).flat():[]),'.npmrc','.yarnrc.yml','pnpm-workspace.yaml']) {
        const file=path.join(item.directory,name);
        if(fs.existsSync(file))files.push([path.relative(root,file).replaceAll('\\','/'),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
    }
    return crypto.createHash('sha256').update(JSON.stringify({files:files.sort((a,b)=>a[0].localeCompare(b[0])),node:process.versions.node,platform:process.platform,arch:process.arch})).digest('hex');
};
