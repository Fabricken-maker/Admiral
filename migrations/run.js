import { initializeDb, initializeSchema } from '../src/utils/db.js';

console.log('🚀 Running database migrations...');

try {
  // Initialize database and create schema
  initializeDb();
  initializeSchema();
  
  console.log('✅ Migrations completed successfully');
  process.exit(0);
} catch (err) {
  console.error('❌ Migration failed:', err);
  process.exit(1);
}
