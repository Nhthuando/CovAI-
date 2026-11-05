import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require = createRequire('C:/Users/thuan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {FileBlob,SpreadsheetFile} = await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const dir='D:/tailieu - NCKH';
for (const name of (await fs.readdir(dir)).filter(n=>n.includes('TestCase'))) {
 const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(`${dir}/${name}`));
 console.log(name,(await wb.inspect({kind:'sheet',include:'id,name',maxChars:2000})).ndjson);
 const sheet=wb.worksheets.getItemAt(0);
 const preview=await wb.render({sheetName:sheet.name,range:'A1:H14',scale:1,format:'png'});
 await fs.writeFile(new URL(name.includes('Sprint1')?'template1.png':'template2.png',import.meta.url),new Uint8Array(await preview.arrayBuffer()));
}
