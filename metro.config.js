const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const fs = require('fs');
const path = require('path');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * node_modules may be a link to another checkout's (scripts/release.sh builds from a copy
 * in /tmp, worktrees share one install): then Metro must watch and resolve from there.
 *
 * @type {import('metro-config').MetroConfig}
 */
const modules = fs.realpathSync(path.join(__dirname, 'node_modules'));
const linked = !modules.startsWith(fs.realpathSync(__dirname) + path.sep);
const config = linked
  ? {watchFolders: [modules], resolver: {nodeModulesPaths: [modules]}}
  : {};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
