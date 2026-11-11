/*
 * shared-libs publishes TypeScript sources. TypeORM must register ts-node
 * before loading the package and must transpile dependencies in node_modules.
 */
process.env.TS_NODE_SKIP_IGNORE = 'true';
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
require('ts-node/register');
require('tsconfig-paths/register');
require('typeorm/cli-ts-node-commonjs');
