import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

async function exists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
    }
}

async function pruneHostedHistory(root: string): Promise<void> {
    const clientDirectory = resolve(root, 'dist', 'client')
    const versionsFile = resolve(clientDirectory, 'parsed_configs', 'versions.json')
    if (!(await exists(versionsFile))) return

    const versions = JSON.parse(await readFile(versionsFile, 'utf8')) as string[]
    const hostedVersions = versions.slice(-7)
    const hostedVersionSet = new Set(hostedVersions)

    for (const parent of ['Texture2D', 'parsed_configs']) {
        const parentDirectory = resolve(clientDirectory, parent)
        if (!(await exists(parentDirectory))) continue
        for (const entry of await readdir(parentDirectory, { withFileTypes: true })) {
            if (entry.isDirectory() && /^\d{4}_\d{2}_\d{2}/.test(entry.name) && !hostedVersionSet.has(entry.name)) {
                await rm(resolve(parentDirectory, entry.name), { recursive: true, force: true })
            }
        }
    }
    await writeFile(versionsFile, `${JSON.stringify(hostedVersions, null, 4)}\n`)
}

export function sites(): Plugin {
    let root = process.cwd()
    return {
        name: 'sites',
        apply: 'build',
        configResolved(config) { root = config.root },
        async closeBundle() {
            await pruneHostedHistory(root)
            const outputDirectory = resolve(root, 'dist', '.openai')
            const hostingConfig = resolve(root, '.openai', 'hosting.json')
            await rm(outputDirectory, { recursive: true, force: true })
            await mkdir(outputDirectory, { recursive: true })
            if (await exists(hostingConfig)) await cp(hostingConfig, resolve(outputDirectory, 'hosting.json'))
        },
    }
}
