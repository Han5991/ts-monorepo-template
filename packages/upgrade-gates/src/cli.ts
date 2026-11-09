import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { z } from 'zod';
import {
  applyReview,
  CandidateSchema,
  detectCandidate,
  recomputeGate,
  ReviewSchema,
  syncRenovate,
  type Blocker,
  type Candidate,
  type Gate,
} from '#/gates.ts';
import {
  GATES_FILE,
  readGates,
  readJson,
  RENOVATE_FILE,
  REPO_ROOT,
  writeJson,
} from '#/repo.ts';

// pnpm gates <명령>
//   sync                         upgrade-gates.json → renovate.json 관문 규칙
//   recompute                    관문마다 막는 쪽의 최신 peer 범위로 상한을 다시 계산한다(풀리면 지운다)
//   detect <후보.json>           관문 없는 직접 의존성 중 새 버전이 막힌 것을 찾는다
//   apply-review <후보.json> <판정.json>   판정(gate: true)을 관문으로 더한다
// 레지스트리(registry.npmjs.org)와 설치된 node_modules를 읽는다. 쓰는 것은 upgrade-gates.json·renovate.json뿐이다.

const PeerMeta = z.record(
  z.string(),
  z.object({ optional: z.boolean().optional() }),
);
const Manifest = z.object({
  peerDependencies: z.record(z.string(), z.string()).optional(),
  peerDependenciesMeta: PeerMeta.optional(),
});
const Packument = z.object({
  versions: z.record(z.string(), Manifest),
  'dist-tags': z.object({ latest: z.string() }),
});
type Packument = z.infer<typeof Packument>;

const packuments = new Map<string, Promise<Packument>>();
function packument(name: string): Promise<Packument> {
  let hit = packuments.get(name);
  if (hit === undefined) {
    hit = fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`).then(
      async res => {
        if (!res.ok) throw new Error(`레지스트리 ${name}: HTTP ${res.status}`);
        return Packument.parse(await res.json());
      },
    );
    packuments.set(name, hit);
  }
  return hit;
}

const ListSchema = z.array(
  z.object({
    dependencies: z
      .record(z.string(), z.object({ version: z.string() }))
      .optional(),
    devDependencies: z
      .record(z.string(), z.object({ version: z.string() }))
      .optional(),
  }),
);

/** 워크스페이스 전체의 직접 의존성 → 설치된 버전(여럿이면 가장 낮은 것). 워크스페이스 링크는 뺀다 */
function installedDirect(): Map<string, string> {
  const list = ListSchema.parse(
    JSON.parse(
      execFileSync('pnpm', ['list', '-r', '--depth', '0', '--json'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }),
    ),
  );
  const out = new Map<string, string>();
  for (const project of list) {
    for (const deps of [project.dependencies, project.devDependencies]) {
      for (const [name, { version }] of Object.entries(deps ?? {})) {
        if (semver.valid(version) === null) continue;
        const prev = out.get(name);
        if (prev === undefined || semver.lt(version, prev))
          out.set(name, version);
      }
    }
  }
  return out;
}

/** 설치된 패키지 중 dep을 (선택이 아닌) peer로 두는 것들. node_modules/.pnpm의 각 패키지 manifest를 읽는다 */
function peerUsers(): Map<string, Set<string>> {
  const store = path.join(REPO_ROOT, 'node_modules', '.pnpm');
  const users = new Map<string, Set<string>>();
  for (const entry of readdirSync(store)) {
    // `@scope+name@1.2.3_peer@4` → `@scope/name`
    const at = entry.indexOf('@', 1);
    if (at < 0) continue;
    const name = entry.slice(0, at).replace('+', '/');
    const file = path.join(store, entry, 'node_modules', name, 'package.json');
    if (!existsSync(file)) continue;
    const manifest = Manifest.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!manifest.success) continue;
    const { peerDependencies = {}, peerDependenciesMeta = {} } = manifest.data;
    for (const dep of Object.keys(peerDependencies)) {
      if (peerDependenciesMeta[dep]?.optional === true) continue;
      const set = users.get(dep) ?? new Set<string>();
      set.add(name);
      users.set(dep, set);
    }
  }
  return users;
}

/** dep을 peer로 두는 패키지들의 **최신판** 범위 — 그 패키지를 올려도 안 되는지를 본다 */
async function blockersOf(
  dep: string,
  users: Map<string, Set<string>>,
): Promise<Blocker[]> {
  const blockers: Blocker[] = [];
  for (const user of [...(users.get(dep) ?? [])].sort()) {
    const p = await packument(user);
    const range = p.versions[p['dist-tags'].latest]?.peerDependencies?.[dep];
    if (range !== undefined) blockers.push({ package: user, range });
  }
  return blockers;
}

const today = () => new Date().toISOString().slice(0, 10);

function sync(): void {
  writeJson(RENOVATE_FILE, syncRenovate(readJson(RENOVATE_FILE), readGates()));
}

async function recompute(): Promise<void> {
  const installed = installedDirect();
  const users = peerUsers();
  const kept: Gate[] = [];
  for (const gate of readGates().gates) {
    const current = installed.get(gate.package);
    if (current === undefined) {
      console.log(`${gate.package}: 설치돼 있지 않다 — 관문을 지운다`);
      continue;
    }
    const next = recomputeGate(gate, {
      versions: Object.keys((await packument(gate.package)).versions),
      current,
      blockers: await blockersOf(gate.package, users),
      today: today(),
    });
    if (next === null) {
      console.log(
        `${gate.package}: 풀렸다 — 막는 쪽이 모든 새 버전을 지원한다`,
      );
    } else {
      if (next.allowedVersions !== gate.allowedVersions) {
        console.log(
          `${gate.package}: ${gate.allowedVersions} → ${next.allowedVersions}`,
        );
      }
      kept.push(next);
    }
  }
  writeJson(GATES_FILE, { gates: kept });
  sync();
}

async function detect(out: string): Promise<void> {
  const gated = new Set(readGates().gates.map(g => g.package));
  const users = peerUsers();
  const candidates: Candidate[] = [];
  for (const [dep, current] of installedDirect()) {
    if (gated.has(dep)) continue;
    const blockers = await blockersOf(dep, users);
    if (blockers.length === 0) continue;
    const candidate = detectCandidate({
      package: dep,
      current,
      versions: Object.keys((await packument(dep)).versions),
      blockers,
    });
    if (candidate !== null) candidates.push(candidate);
  }
  writeFileSync(out, `${JSON.stringify(candidates, null, 2)}\n`);
  console.log(`후보 ${String(candidates.length)}개`);
  for (const c of candidates) {
    console.log(
      `- ${c.package} ${c.current} → ${c.latest}: ${c.blockedAt}부터 막힘 (${c.blockers.map(b => `${b.package} ${b.range}`).join(', ')})`,
    );
  }
}

function applyReviewFiles(candidatesFile: string, reviewFile: string): void {
  const candidates = z
    .array(CandidateSchema)
    .parse(JSON.parse(readFileSync(candidatesFile, 'utf8')));
  const review = ReviewSchema.parse(
    JSON.parse(readFileSync(reviewFile, 'utf8')),
  );
  writeJson(GATES_FILE, applyReview(readGates(), candidates, review, today()));
  sync();
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'sync':
    sync();
    break;
  case 'recompute':
    await recompute();
    break;
  case 'detect': {
    const [out] = args;
    if (out === undefined) throw new Error('사용: gates detect <후보.json>');
    await detect(out);
    break;
  }
  case 'apply-review': {
    const [candidatesFile, reviewFile] = args;
    if (candidatesFile === undefined || reviewFile === undefined) {
      throw new Error('사용: gates apply-review <후보.json> <판정.json>');
    }
    applyReviewFiles(candidatesFile, reviewFile);
    break;
  }
  default:
    throw new Error(
      `모르는 명령: ${command ?? '(없음)'} — sync·recompute·detect·apply-review`,
    );
}
