import bcrypt from 'bcryptjs';

async function main() {
  const password = process.argv.slice(2).join(' ');
  if (!password) {
    console.error('Usage: npm run hash:password -- "your-password"');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  console.log(hash);
}

main().catch((error) => {
  console.error('Failed to hash password:', error);
  process.exit(1);
});
