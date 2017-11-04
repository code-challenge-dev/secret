'use strict';

const chalk = require('chalk');
const path = require('path');
const spawnSync = require('child_process').spawnSync;
const glob = require('glob');

const extension = process.platform === 'win32' ? '.cmd' : '';

// Performs sanity checks on bundles *built* by Rollup.
// Helps catch Rollup regressions.
function lint({format, filePatterns}) {
  console.log(`Linting ${format} bundles...`);
  const result = spawnSync(
    path.join('node_modules', '.bin', 'eslint' + extension),
    [
      ...filePatterns,
      '--config',
      path.join(__dirname, `eslintrc.${format}.js`),
      // Disregard our ESLint rules that apply to the source.
      '--no-eslintrc',
      // Use a different ignore file.
      '--ignore-path',
      path.join(__dirname, 'eslintignore'),
    ],
    {
      // Allow colors to pass through
      stdio: 'inherit',
    }
  );
  if (result.status !== 0) {
    console.error(chalk.red(`Linting of ${format} bundles has failed.`));
    process.exit(result.status);
  } else {
    console.log(chalk.green(`Linted ${format} bundles successfully!`));
    console.log();
  }
}

function checkFilesExist(bundle) {
  const {format, filePatterns} = bundle;
  filePatterns.map(pattern => {
    console.log(`Check if files exist in ${pattern}`);
    const files = glob.sync(pattern);
    if (files.length === 0) {
      console.error(
        chalk.red(
          `No files found in glob pattern ${pattern} in ${format} bundle.`
        )
      );
      process.exit();
    } else {
      console.log(chalk.green(`${files.length} files found.`));
      console.log();
    }
  });
  return bundle;
}

const bundles = [
  {
    format: 'fb',
    filePatterns: [`./build/facebook-www/*.js`],
  },
  {
    format: 'rn',
    filePatterns: [`./build/{react-cs,react-native,react-rt}/*.js`],
  },
  {
    format: 'umd',
    filePatterns: [`./build/packages/*/umd/*.js`],
  },
  {
    format: 'cjs',
    filePatterns: [`./build/packages/*/*.js`, `./build/packages/*/cjs/*.js`],
  },
];

bundles.map(checkFilesExist).map(lint);
