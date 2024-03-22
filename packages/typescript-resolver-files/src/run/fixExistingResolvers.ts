import { existsSync } from 'fs';
import { Project } from 'ts-morph';
import * as path from 'path';
import type { ResolverFile, RunResult } from '../types';

export const fixExistingResolvers = (result: RunResult) => {
  const existingResolverFiles = Object.entries(result.files).reduce<
    Record<string, ResolverFile>
  >((res, [filePath, file]) => {
    if (existsSync(filePath) && file.__filetype === 'resolver') {
      res[filePath] = file;
    }
    return res;
  }, {});

  const project = new Project();
  project.addSourceFilesAtPaths(Object.keys(existingResolverFiles));
  const sourceFiles = project.getSourceFiles();
  sourceFiles.forEach((sourceFile) => {
    const normalisedRelativePath = path.relative(
      process.cwd(),
      sourceFile.getFilePath()
    );
    const file = existingResolverFiles[normalisedRelativePath];
    if (!file) {
      throw new Error(
        `Unable to find resolver file: ${normalisedRelativePath}`
      );
    }

    // TODO: Check missing import
    // ...

    // Check expected identifier
    let isExpectedIdentifierExportedInVariableStatement = false;
    const variableStatementWithExpectedIdentifier =
      sourceFile.getVariableStatement((statement) => {
        let hasExpectedIdentifier = false;
        statement
          .getDeclarationList()
          .getDeclarations()
          .forEach((declarationNode) => {
            if (declarationNode.getName() === file.mainImportIdentifier) {
              hasExpectedIdentifier = true;
              if (statement.isExported()) {
                isExpectedIdentifierExportedInVariableStatement = true;
              }
            }
          });

        if (!hasExpectedIdentifier) {
          return false;
        }
        return true;
      });

    if (!variableStatementWithExpectedIdentifier) {
      // Did not find variable statement with expected identifier, add it to the end with a warning
      sourceFile.addStatements(
        '/* WARNING: The following resolver was missing from this file. Make sure it is properly implemented or there could be runtime errors. */'
      );
      sourceFile.addStatements(file.meta.resolverVariableStatement);
    } else if (
      variableStatementWithExpectedIdentifier &&
      !isExpectedIdentifierExportedInVariableStatement
    ) {
      // If has identifier but not exported
      // Add export keyword to statement
      const isExpectedIdentifierExported = Boolean(
        sourceFile.getExportedDeclarations().get(file.mainImportIdentifier)
      );
      if (!isExpectedIdentifierExported) {
        variableStatementWithExpectedIdentifier.setIsExported(true);
      }
      // else, if identifier's been exported do nothing
    }

    // Overwrite existing files with fixes
    result.files[normalisedRelativePath] = {
      ...file,
      content: sourceFile.getText(),
    };
  });
};
