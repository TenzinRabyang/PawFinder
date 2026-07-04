const { Client } = require('pg');

const regions = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'sa-east-1', 'ca-central-1', 'me-central-1', 'af-south-1'
];

async function checkRegion(region) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const connectionString = `postgresql://postgres.oidrbydcunkceabamadp:Love%25acoustic%230@${host}:6543/postgres`;
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    console.log(`Success with ${region}`);
    await client.end();
    return connectionString;
  } catch (err) {
    return null;
  }
}

async function main() {
  const promises = regions.map(r => checkRegion(r));
  const results = await Promise.all(promises);
  const found = results.find(r => r !== null);
  if (found) {
    console.log("FOUND_CONNECTION_STRING=" + found);
  } else {
    console.log("Not found in common regions.");
  }
}
main();