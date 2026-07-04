const { Client } = require('pg');

async function check() {
  const host = `aws-0-eu-west-2.pooler.supabase.com`;
  const connectionString = `postgresql://postgres.oidrbydcunkceabamadp:Love%25acoustic%230@${host}:6543/postgres`;
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    console.log("Success!");
    await client.end();
  } catch (err) {
    console.error("Error:", err.message);
  }
}

check();