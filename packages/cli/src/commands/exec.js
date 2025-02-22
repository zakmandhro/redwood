import path from 'path'

import Listr from 'listr'
import VerboseRenderer from 'listr-verbose-renderer'
import terminalLink from 'terminal-link'

import { findScripts, registerApiSideBabelHook } from '@redwoodjs/internal'

import { getPaths } from '../lib'
import c from '../lib/colors'
import { generatePrismaClient } from '../lib/generatePrismaClient'

const runScript = async (scriptPath, scriptArgs) => {
  const script = await import(scriptPath)
  await script.default({ args: scriptArgs })

  try {
    const { db } = await import(path.join(getPaths().api.lib, 'db'))
    db.$disconnect()
  } catch (e) {
    // silence
  }

  return
}

export const command = 'exec <name>'
export const description = 'Run scripts generated with yarn generate script'
export const builder = (yargs) => {
  yargs
    .positional('name', {
      description: 'The file name (extension is optional) of the script to run',
      type: 'string',
    })
    .option('prisma', {
      type: 'boolean',
      default: true,
      description: 'Generate the Prisma client',
    })
    .strict(false)
    .epilogue(
      `Also see the ${terminalLink(
        'Redwood CLI Reference',
        'https://redwoodjs.com/docs/cli-commands#up'
      )}`
    )
}

export const handler = async (args) => {
  const { name, prisma, ...scriptArgs } = args
  const scriptPath = path.join(getPaths().scripts, name)

  // Import babel config for running script
  registerApiSideBabelHook({
    plugins: [
      [
        'babel-plugin-module-resolver',
        {
          alias: {
            $api: getPaths().api.base,
            $web: getPaths().web.base,
          },
        },
        'exec-$side-module-resolver',
      ],
    ],
    overrides: [
      {
        test: ['./api/'],
        plugins: [
          [
            'babel-plugin-module-resolver',
            {
              alias: {
                src: getPaths().api.src,
              },
            },
            'exec-api-src-module-resolver',
          ],
        ],
      },
      {
        test: ['./web/'],
        plugins: [
          [
            'babel-plugin-module-resolver',
            {
              alias: {
                src: getPaths().web.src,
              },
            },
            'exec-web-src-module-resolver',
          ],
        ],
      },
    ],
  })

  try {
    require.resolve(scriptPath)
  } catch {
    console.error(
      c.error(`\nNo script called ${c.underline(name)} in ./scripts folder.\n`)
    )

    console.log('Available scripts:')
    findScripts().forEach((scriptPath) => {
      const { name } = path.parse(scriptPath)
      console.log(c.info(`- ${name}`))
    })
    console.log()
    process.exit(1)
  }

  const scriptTasks = [
    {
      title: 'Generating Prisma client',
      enabled: () => prisma,
      task: () => generatePrismaClient({ force: false }),
    },
    {
      title: 'Running script',
      task: async () => {
        try {
          await runScript(scriptPath, scriptArgs)
        } catch (e) {
          console.error(c.error(`Error in script: ${e.message}`))
        }
      },
    },
  ]

  const tasks = new Listr(scriptTasks, {
    collapse: false,
    renderer: VerboseRenderer,
  })

  try {
    await tasks.run()
  } catch (e) {
    console.error(c.error(`The script exited with errors.`))
    process.exit(e?.exitCode || 1)
  }
}
