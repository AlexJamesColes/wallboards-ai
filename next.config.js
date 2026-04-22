/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // Next.js 14.2 still uses the experimental key for this option;
  // the top-level `serverExternalPackages` belongs to v15+.
  experimental: {
    serverComponentsExternalPackages: ['pg', 'pg-hstore', 'mssql', 'tedious'],
  },
};
