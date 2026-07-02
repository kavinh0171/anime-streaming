require('dotenv').config();
const supabase = require('../../database/config');

async function testConnection() {
  console.log('Testing Supabase connection...');
  try {
    const { data, error } = await supabase.from('genres').select('count', { count: 'exact', head: true });
    if (error) {
      console.error('Connection failed:', error.message);
      process.exit(1);
    }
    console.log('✓ Supabase connection successful');
    console.log('✓ Database is accessible');

    const { data: tables, error: tableError } = await supabase
      .rpc('get_schema_tables')
      .catch(() => ({ data: null, error: null }));

    if (!tableError) {
      console.log('✓ Schema tables:');
    }

    process.exit(0);
  } catch (err) {
    console.error('Connection error:', err.message);
    process.exit(1);
  }
}

testConnection();
