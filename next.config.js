/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  serverExternalPackages: [
    'sequelize',
    'pg',
    'pg-hstore',
    'pg-native',
    'mssql',
    'tedious',
    'sequelize-parse-url',
    'bcryptjs',
  ],
};
