const fs = require('fs');
const file = 'client/src/components/dashboard/IntegrationWorkspace.jsx';
let content = fs.readFileSync(file, 'utf8');
const sIdx = content.indexOf('<<<<<<< Updated upstream');
const eIdx = content.indexOf('>>>>>>> Stashed changes');
if (sIdx !== -1 && eIdx !== -1) {
  const lineEnd = content.indexOf('\n', eIdx);
  const replacement = `    const token = localStorage.getItem("token");
    const eventSource = new EventSource(
      \`\${BASE_URL}/job/\${jobId}/stream?token=\${token}\`,
    );`;
  // check what comes after eIdx line
  const nextPart = content.substring(lineEnd + 1).replace(/^\s*\);\s*\n/, '');
  content = content.substring(0, sIdx) + replacement + '\n' + nextPart;
  fs.writeFileSync(file, content, 'utf8');
  console.log('Resolved IntegrationWorkspace.jsx successfully!');
} else {
  console.log('Markers not found');
}
