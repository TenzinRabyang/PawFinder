const { Client } = require('pg');

async function main() {
  const connectionString = "postgresql://postgres:Love%25acoustic%230@db.oidrbydcunkceabamadp.supabase.co:5432/postgres";
  const client = new Client({
    connectionString,
  });

  try {
    await client.connect();
    console.log("Connected to DB successfully.");
    const res = await client.query('SELECT NOW()');
    console.log(res.rows[0]);
  } catch (err) {
    console.error("Connection error", err.stack);
  } finally {
    await client.end();
  }
}

main();