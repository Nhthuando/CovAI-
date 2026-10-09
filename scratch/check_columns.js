import prisma from "../server/src/config/prisma.js";

async function main() {
  const row = await prisma.$queryRawUnsafe(
    'SELECT * FROM "TestScenario" LIMIT 3'
  );
  console.log("Sample TestScenario:", JSON.stringify(row, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value, 2));

  const columns = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'TestScenario'"
  );
  console.log("Column definitions:", columns);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
