import prisma from './src/config/prisma.js';

async function main() {
    console.log("Prisma models:", Object.keys(prisma).filter(k => !k.startsWith('$') && !k.startsWith('_')));
}

main().catch(console.error).finally(() => process.exit(0));
