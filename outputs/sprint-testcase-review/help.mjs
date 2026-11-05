import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire('C:/Users/thuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {Workbook}=await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const wb=Workbook.create();
console.log(wb.help('worksheet.delete',{include:'index,examples,notes',maxChars:2500}).ndjson);
