#!/usr/bin/env node

'use strict';

const {join} = require('path');
const {readJsonSync} = require('fs-extra');
const {getPublicPackages, handleError} = require('./utils');
const theme = require('./theme');

const checkNPMPermissions = require('./publish-commands/check-npm-permissions');
const confirmSkippedPackages = require('./publish-commands/confirm-skipped-packages');
const confirmVersionAndTags = require('./publish-commands/confirm-version-and-tags');
const parseParams = require('./publish-commands/parse-params');
const printFollowUpInstructions = require('./publish-commands/print-follow-up-instructions');
const promptForOTP = require('./publish-commands/prompt-for-otp');
const publishToNPM = require('./publish-commands/publish-to-npm');
const updateStableVersionNumbers = require('./publish-commands/update-stable-version-numbers');
const validateTags = require('./publish-commands/validate-tags');
const validateSkipPackages = require('./publish-commands/validate-skip-packages');

const run = async () => {
  try {
    const params = parseParams();

    const version = readJsonSync('./build/node_modules/react/package.json')
      .version;
    const isExperimental = version.includes('experimental');

    params.cwd = join(__dirname, '..', '..');
    params.packages = await getPublicPackages(isExperimental);

    // Pre-filter any skipped packages to simplify the following commands.
    // As part of doing this we can also validate that none of the skipped packages were misspelled.
    params.skipPackages.forEach(packageName => {
      const index = params.packages.indexOf(packageName);
      if (index < 0) {
        console.log(
          theme`Invalid skip package {package ${packageName}} specified.`
        );
        process.exit(1);
      } else {
        params.packages.splice(index, 1);
      }
    });

    await validateTags(params);
    await confirmSkippedPackages(params);
    await confirmVersionAndTags(params);
    await validateSkipPackages(params);
    await checkNPMPermissions(params);

    while (true) {
      try {
        const otp = await promptForOTP(params);
        await publishToNPM(params, otp);
        break;
      } catch (error) {
        console.error(error.message);
        console.log();
        console.log(
          theme.error`Publish failed. Enter a fresh otp code to retry.`
        );
        continue;
      }
    }

    await updateStableVersionNumbers(params);
    await printFollowUpInstructions(params);
  } catch (error) {
    handleError(error);
  }
};

run();
