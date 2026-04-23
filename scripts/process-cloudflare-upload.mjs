import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT_ROOT = process.env.PROJECT_ROOT || '/home/kaixin/work-ai/reader';
const DATABASE_NAME = process.env.CLOUDFLARE_D1_DATABASE_NAME || 'reader-db';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `${command} failed`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function d1Execute(sql) {
  const args = ['wrangler', 'd1', 'execute', DATABASE_NAME, '--remote', '--json', '--command', sql];
  if (process.env.WRANGLER_CONFIG_PATH) {
    args.push('--config', process.env.WRANGLER_CONFIG_PATH);
  }
  const { stdout } = await run('npx', args);
  return stdout;
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

function parseRows(stdout) {
  const parsed = JSON.parse(stdout);
  const first = Array.isArray(parsed) ? parsed[0] : null;
  const results = first?.results;
  return Array.isArray(results) ? results : [];
}

async function loadPendingJobs() {
  const sql = "SELECT id, filename, release_tag, asset_name, asset_url, raw_target, size, status FROM upload_jobs WHERE status = 'pending' ORDER BY uploaded_at ASC;";
  return parseRows(await d1Execute(sql));
}

async function updateJobStatus(id, status, extra = {}) {
  const sets = [`status = '${escapeSql(status)}'`];

  if (extra.publishedAt) {
    sets.push(`published_at = '${escapeSql(extra.publishedAt)}'`);
  }
  if (extra.failedAt) {
    sets.push(`failed_at = '${escapeSql(extra.failedAt)}'`);
  }
  if (Object.prototype.hasOwnProperty.call(extra, 'errorMessage')) {
    sets.push(`error_message = ${extra.errorMessage ? `'${escapeSql(extra.errorMessage)}'` : 'NULL'}`);
  }

  await d1Execute(`UPDATE upload_jobs SET ${sets.join(', ')} WHERE id = '${escapeSql(id)}';`);
}

async function downloadAsset(job, targetPath) {
  if (!GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN 未配置，无法下载 GitHub Releases 资产。');
  }

  const response = await fetch(job.asset_url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/octet-stream',
      'User-Agent': 'reader-upload-processor',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`下载 GitHub Releases 资产失败（${response.status}）`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(targetPath, Buffer.from(arrayBuffer));
}

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), 'reader-cloudflare-upload-'));

  try {
    const pending = await loadPendingJobs();

    if (pending.length === 0) {
      console.log('No pending uploads.');
      return;
    }

    let deployed = false;
    const failures = [];

    for (const job of pending) {
      await updateJobStatus(job.id, 'processing', { errorMessage: null });
      const epubPath = join(tempDir, `${job.id}.epub`);

      try {
        await downloadAsset(job, epubPath);
        await run('python3', ['./scripts/epub-preprocess/import_epub.py', epubPath, job.raw_target]);
        await updateJobStatus(job.id, 'published', {
          publishedAt: new Date().toISOString(),
          errorMessage: null
        });
        deployed = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        await updateJobStatus(job.id, 'failed', {
          failedAt: new Date().toISOString(),
          errorMessage: message
        });
        failures.push(`${job.id}: ${message}`);
      } finally {
        await rm(epubPath, { force: true }).catch(() => {});
      }
    }

    if (deployed) {
      await run('bash', ['./scripts/deploy-cloudflare.sh']);
    }

    if (failures.length > 0) {
      throw new Error(`部分上传处理失败:\n${failures.join('\n')}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
