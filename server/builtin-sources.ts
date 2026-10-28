import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BuiltinSourceInfo, FeatureTestSource } from '../shared/feature-test.ts';
import { hashWebsite } from './codex.ts';
import { fail } from './input.ts';
import { safeFilePath } from './security.ts';
import { bundledWebsiteDirectory } from './paths.ts';

export const builtinWebsiteRoot = bundledWebsiteDirectory;
export const builtinSourceCatalog: ReadonlyArray<BuiltinSourceInfo & { title: string }> = [
  { slug: 'dashboard', title: '数据 Dashboard', description: '指标卡、趋势图和订单表格，测试高密度数据界面。', style: 'neon', order: 0 },
  { slug: 'resume', title: '个人简历', description: '个人介绍、技能与经历时间线，测试信息层级和长文排版。', style: 'classic', order: 1 },
  { slug: 'blog', title: '个人博客', description: '文章列表、分类筛选和阅读详情，测试内容型页面。', style: 'classic', order: 2 },
  { slug: 'saas', title: 'SaaS 产品官网', description: '产品介绍、功能卡片和定价，测试营销落地页。', style: 'classic', order: 3 },
  { slug: 'portfolio', title: '设计师作品集', description: '项目网格、作品筛选和项目详情，测试视觉展示页面。', style: 'neon', order: 4 },
  { slug: 'store', title: '电商商品页', description: '商品筛选、购物车与金额汇总，测试商品浏览和购买界面。', style: 'classic', order: 5 },
  { slug: 'courses', title: '在线课程', description: '课程目录、分类筛选和学习进度，测试学习类界面。', style: 'classic', order: 6 },
  { slug: 'event', title: '活动报名', description: '活动介绍、议程与报名表单，测试信息展示和表单布局。', style: 'neon', order: 7 },
];

/** Freeze each shipped revision once. Existing revisions remain addressable by their content hash. */
export async function freezeBuiltinSources(sourcesRoot: string, assetsRoot = builtinWebsiteRoot): Promise<FeatureTestSource[]> {
  await mkdir(sourcesRoot, { recursive: true });
  const results = await Promise.allSettled(builtinSourceCatalog.map(async ({ title, ...builtin }) => {
    const website = path.join(assetsRoot, builtin.slug);
    await safeFilePath(website, 'index.html');
    const hash = await hashWebsite(website);
    const id = `builtin-${builtin.slug}-${hash}`;
    const destination = path.join(sourcesRoot, id);
    const readExisting = async (): Promise<FeatureTestSource | undefined> => {
      let source: FeatureTestSource;
      try { source = JSON.parse(await readFile(await safeFilePath(destination, 'source.json'), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
      await safeFilePath(path.join(destination, 'website'), 'index.html');
      if (source.runId !== id || source.hash !== hash || source.builtin?.slug !== builtin.slug || await hashWebsite(path.join(destination, 'website')) !== hash) {
        fail('内置原网页的冻结副本已改变，不能覆盖历史来源。', 409);
      }
      return source;
    };
    const existing = await readExisting();
    if (existing) return existing;
    const source: FeatureTestSource = {
      experimentId: `builtin-${builtin.slug}`, versionId: id, versionNumber: 1, runId: id,
      title, createdAt: new Date().toISOString(), hash,
      config: { model: 'builtin', reasoningEffort: 'none', cliVersion: 'bundled' },
      requirements: builtin.description, builtin,
    };
    const staging = path.join(sourcesRoot, `.builtin-${randomUUID()}`);
    try {
      await mkdir(staging);
      await cp(website, path.join(staging, 'website'), { recursive: true });
      if (await hashWebsite(path.join(staging, 'website')) !== hash) fail('内置原网页复制校验失败。', 409);
      await writeFile(path.join(staging, 'source.json'), JSON.stringify(source, null, 2), { mode: 0o600 });
      try { await rename(staging, destination); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
        const winner = await readExisting();
        if (!winner) throw error;
        return winner;
      }
      return source;
    } finally { await rm(staging, { recursive: true, force: true }); }
  }));
  const sources: FeatureTestSource[] = [];
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
    sources.push(result.value);
  }
  return sources;
}
