import path from 'node:path';
import {parseJavaScriptCode} from './babelParser.service.js';
import _traverse from '@babel/traverse';
const traverse=_traverse.default || _traverse;
const literal=node=>node?.type==='StringLiteral'?node.value:null;
const localPath=value=>typeof value==='string' && /^\/(?!\/)[\w/.-]*$/.test(value);

// Resolve Express router imports and mounts by their actual bindings. Filename
// similarity cannot establish that a router is mounted at a particular URL.
export const discoverReadinessPaths = files => {
    const modules=new Map();
    for(const file of files) {
        if(!/\.[cm]?[jt]s$/.test(file.path) || /(?:^|\/)(?:__tests__|__mocks__)\/|\.(?:test|spec)\./.test(file.path))continue;
        const parsed=parseJavaScriptCode(file.content);if(!parsed.success)continue;
        const record={imports:new Map(),express:new Set(),routerFactories:new Set(),routers:new Map(),exported:null};
        const required=node=>node?.type==='CallExpression' && node.callee.name==='require'?literal(node.arguments[0]):null;
        traverse(parsed.ast,{
            ImportDeclaration({node}) {
                for(const spec of node.specifiers) {
                    if(node.source.value==='express') {
                        if(spec.type==='ImportSpecifier' && spec.imported.name==='Router')record.routerFactories.add(spec.local.name);
                        else record.express.add(spec.local.name);
                    } else if(spec.type==='ImportDefaultSpecifier')record.imports.set(spec.local.name,node.source.value);
                }
            },
            VariableDeclarator({node}) {
                const request=required(node.init);
                if(node.id.type!=='Identifier')return;
                if(request==='express')record.express.add(node.id.name);
                else if(request)record.imports.set(node.id.name,request);
            },
        });
        traverse(parsed.ast,{
            VariableDeclarator({node}) {
                const callee=node.init?.type==='CallExpression'?node.init.callee:null;
                if(node.id.type!=='Identifier' || !callee)return;
                const app=callee.type==='Identifier' && record.express.has(callee.name);
                const router=callee.type==='Identifier' && record.routerFactories.has(callee.name) || callee.type==='MemberExpression' && record.express.has(callee.object.name) && callee.property.name==='Router';
                if(app||router)record.routers.set(node.id.name,{app,routes:[],mounts:[]});
            },
            AssignmentExpression({node}) {
                if(node.left.type==='MemberExpression' && node.left.object.name==='module' && node.left.property.name==='exports' && node.right.type==='Identifier')record.exported=node.right.name;
            },
            ExportDefaultDeclaration({node}) {if(node.declaration.type==='Identifier')record.exported=node.declaration.name;},
        });
        traverse(parsed.ast,{
            CallExpression({node}) {
                if(node.callee.type!=='MemberExpression')return;
                const router=record.routers.get(node.callee.object.name);if(!router)return;
                const method=node.callee.property.name,route=literal(node.arguments[0]);
                if(method==='get' && node.arguments.length>=2 && localPath(route))router.routes.push(route);
                if(method==='use') {
                    const prefix=route ?? '/';if(!localPath(prefix))return;
                    for(const target of node.arguments.slice(route===null?0:1)) {
                        if(target.type==='Identifier')router.mounts.push({prefix,target:target.name});
                        else {const imported=required(target);if(imported)router.mounts.push({prefix,imported});}
                    }
                }
            },
        });
        modules.set(file.path.replaceAll('\\','/'),record);
    }
    const paths=new Set();
    const resolve=(file,request)=>{
        if(!request?.startsWith('.'))return null;
        const base=path.posix.normalize(path.posix.join(path.posix.dirname(file),request));
        return [base,...['.js','.cjs','.mjs','.ts','/index.js','/index.ts'].map(ext=>base+ext)].find(name=>modules.has(name));
    };
    const walk=(file,name,prefix='',seen=new Set())=>{
        const key=file+':'+name;if(seen.has(key)||seen.size>32)return;
        const record=modules.get(file),router=record?.routers.get(name);if(!router)return;
        const visited=new Set([...seen,key]);
        const join=route=>('/'+[prefix,route].map(value=>value.replace(/^\/+|\/+$/g,'')).filter(Boolean).join('/'));
        for(const route of router.routes)paths.add(join(route));
        for(const mount of router.mounts) {
            if(record.routers.has(mount.target))walk(file,mount.target,join(mount.prefix),visited);
            else {
                const target=resolve(file,mount.imported || record.imports.get(mount.target));
                if(target)walk(target,modules.get(target).exported,join(mount.prefix),visited);
            }
        }
    };
    for(const [file,record] of modules)for(const [name,router] of record.routers)if(router.app)walk(file,name);
    return [...paths].sort((a,b)=>{
        const rank=value=>/\/(?:health|healthz|ready|readyz)$/.test(value)?0:value==='/'?1:2;
        return rank(a)-rank(b)||a.length-b.length||a.localeCompare(b);
    });
};
