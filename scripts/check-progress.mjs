import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'planning/progress.json');
const progress = JSON.parse(readFileSync(path, 'utf8'));
const backlog = JSON.parse(readFileSync(resolve(root, 'planning/backlog.json'), 'utf8'));
const mapping = JSON.parse(readFileSync(resolve(root, 'planning/issue-map.json'), 'utf8'));
const ensure = (valid, reason) => { if (!valid) throw new Error(`Progress guard: ${reason}`); };

ensure(progress.schemaVersion === 1, 'unsupported schema');
ensure(progress.observedAt === '2026-10-18', 'observation requires a new review');
ensure(progress.backlog.epics === backlog.epics.length && progress.backlog.epics === 9, 'epic count');
ensure(progress.backlog.stories === backlog.stories.length && progress.backlog.stories === 54, 'story count');
ensure(progress.backlog.mappedIssues === Object.keys(mapping.issues).length && progress.backlog.mappedIssues === 63, 'issue mapping count');
const numbers = Object.values(mapping.issues).map((entry) => entry.number);
ensure(new Set(numbers).size === 63 && [1, 2, 3].every((id) => !numbers.includes(id)), 'issue collision');
ensure(JSON.stringify(progress.backlog.crosscuttingIssues) === '[1,2,3]' && progress.backlog.totalIssues === 66, 'issue totals');
const a = progress.acceptance;
ensure(a && Object.keys(a).sort().join(',') ===
  'atomicCoreChromiumRevocation,commercialAutomationAuthorized,commercialProvidersOperational,nativeDesktopElectronE2E,productionAcceptedStoryIDs,webbridgeWritesEnabled', 'acceptance fields');
ensure(Array.isArray(a.productionAcceptedStoryIDs) && a.productionAcceptedStoryIDs.length === 0, 'production acceptance unproven');
ensure(JSON.stringify(a.commercialProvidersOperational) ===
  '["chatgpt","deepseek","gemini","qwen","mistral"]',
  'commercial provider list must be exactly the five demonstrated conversations');
for (const name of ['nativeDesktopElectronE2E', 'atomicCoreChromiumRevocation', 'commercialAutomationAuthorized', 'webbridgeWritesEnabled'])
  ensure(a[name] === false, `unsafe production gate ${name}`);

const firstPR = 142;
const lastVerifiedPR = 277;
// Independently transcribed from exact-SHA GitHub CI runs at review time; never
// queried from GitHub by this guard, so local evidence substitution is refused.
// Evidence = head SHA with zero failing gh-pr-checks rows when transcribed
// (2026-10-17 review: PRs 142-201; 2026-10-18 review: PRs 202-263). For the
// 2026-10-18 review, checks counts the gh pr checks rows reported at review
// time; 142-201 keep the historical era formulas of the 2026-10-17 review.
// Unverified = head SHA red at review time (failing check rows), pinned with a
// reason, never merged and superseded; it is traceability, not evidence.
const lockedRecentHeads = new Map([
  [174, 'b4e312052e7eab9b6c8c31a72d43860278142b62'],
  [175, '2d2597f56a670996aa0a61a1d6c43342d3d453a8'],
  [176, '5af254a0c09dad55113848275fb6e03892478d02'],
  [177, 'e9d0389eba9aeb4e633b02e5e2f874b4854ffaaa'],
  [178, '98bd8001fc71fbd5263af54d1c982b05b97d7606'],
  [179, '65dd9ddae854866aa8a634a57b361aed7eb3f793'],
  [180, '5bee54e833e0733c2ca4ceafc29a8e9641e21fe6'],
  [181, 'ca39c9f9a2a251f834043a67b540d14b8a4e272c'],
  [182, '5929211bffb1c533eb7a789ca8cdb3ee20effb8d'],
  [183, '7826fb37d872754d1d244c6edc4a885b15b64db6'],
  [184, 'b0e3257081a7b37f49aa826bc9f1f26246403c38'],
  [185, 'ad48b58f2193f7a8b3a3ba4c7db640fb3a87a6fc'],
  [186, '1dbef42e7a59c73243e9436b592044c9b0cc4eec'],
  [187, 'aaefcf8c0ef2776ba6bd62a587eafbe749f18b30'],
  [188, '9c7b3ac661b5ce70c407c1fcca2db7354bf545a9'],
  [189, 'bb655668c8c081e122736d3e1f712f339384aab6'],
  [190, 'e1a04479876fcb469309cbbb9526639964bf35e3'],
  [191, 'b3a2ce1378b072985a688cf8fe14be99e590f887'],
  [192, 'fc6fcbc541310273102e655c605191576ad5e406'],
  [193, 'da9fcbe356b472e42a3dc68061c69c0f8da649e9'],
  [194, '983a3356db904791db8e3f323bdb27520eafb0e7'],
  [195, 'cfb2fcf6d4910608e35ab5b1549eabe43cd7931a'],
  [196, 'f736af63a63aa937650e013774ace625cb1ebfa5'],
  [197, '22474d8c9a6434d6939269de0559fa798db7ac8b'],
  [198, '25fb3992d8436f7534b4091925bab5705442171a'],
  [199, 'c33c8d0ea993b6c0a41cae63362edfbe68a01b3e'],
  [200, '1c8e134b71f349c7c2d046caff6ee5ff22fb7b80'],
  [201, 'a8b0e9cfa90157ec9aef50d9163d12bafa41b744'],
  [202, '59947c5a3f08bf7f299708a301fe22754a4f2833'],
  [203, 'be6d5567e3df23cfec3a4050e76d0b904c59d6a1'],
  [204, 'a8a96d0640b147154f1e3def279444904cbc08ef'],
  [205, '63092b5003f8af5284cd1b737e900c704eeab2a4'],
  [206, '30ead17b53b7f8f742fed3a69e98d64f28f2f477'],
  [207, '200ae6808a9c4185712b8594d1915fd2b4442d50'],
  [208, 'eafcc3ae05b7c4cbabfb163675d9731a92489dd2'],
  [209, 'd5993f1b0950a0f1b9e5f4e9daca6bb2130a1de2'],
  [210, '41b642225860272cf39e73037aed6e20b7262a78'],
  [211, 'ab73b2740caeb268c3f1e327aeef4029618933f9'],
  [212, 'db045f119f512af1670e14564555c72536a30166'],
  [213, '41bfbf02244050374d4c4555ccdfd626cfe51c10'],
  [214, 'f0d9f361878d45477625f2fa6afe72b99773ba15'],
  [215, 'd003be0aebedd4b4f0ef27a09ccf8c604ddde06b'],
  [216, 'bd205d256d92fad358b0e300471752e173206de1'],
  [217, 'b915db8338b130b9f923fdd263b58e4a21ddd22b'],
  [218, 'eba1c3bd9d5eaf0ec58dd2988613ed892110fbc0'],
  [219, '0fd5e2fa04df4238e12277ac8674d0d6da8d71d3'],
  [220, 'ecdbe4adfd1c001805a72ad90f321c7e23dc7c65'],
  [221, '539fe2c86b7ab679c8fa59f6d60d0d435d0e43a1'],
  [222, '963a98692764ce07e23245bd820143f56827749b'],
  [223, '27e3e919b1a9429a6304d0f500760d2d9819ec7d'],
  [224, '05cf830d1f0601ae93e083f2533a85d5363c0e30'],
  [225, '2daa58192d30936abbc625c22fc14aee676a3635'],
  [226, '02e9439f43b6fc476d0cec0b2afda36c654c4c71'],
  [227, '8ad61ae630e0905c7c902503877c24be3f9be460'],
  [228, 'cd01f129c4b0c04ef39092bf5677d433b028af7c'],
  [229, 'c775a3bd2cf49a7f62d060f52a81391c82d8a351'],
  [230, '647ec65ea8daac68a3c6479f99562f921a0e3e89'],
  [231, '752ed505478b08709033af9c729a8e20a9a266a9'],
  [232, '77b2711a745d1b9d79e6a1e0bc0fa7209ae0a582'],
  [233, '6da5ee6dbf43e2a3a4132673fc33f883238cab33'],
  [234, 'b67e3d07ae7ec32cc944efffae54d3231fcbfb28'],
  [235, 'c1c0ded8e813266e8b8c9e77a0034eea50367348'],
  [236, '651d1b12dc2fe5add48db798e6f548dca634efa4'],
  [237, 'eb545975a548d914a175305f894939b3255b7144'],
  [238, 'e380b106eaefe48ff27f1cb2473d1d938bb9d7ab'],
  [239, '1a1786c4afb7abef835529009b16f75a092792c2'],
  [240, 'e7bf78743383cf4d3c887ae36c5ce8c782c3a889'],
  [241, '84cf808b105b26fe7df65d1030551faf34bcb42d'],
  [242, 'e8c896ebdd6c374c03e46217671a920716cab95b'],
  [243, 'b7f2460702cae9fe74f4b3b8a4eecae278af2899'],
  [244, '82214090b70b400cf0b4a903fe9a09cbd0619578'],
  [245, '4cd5ab9b1f6dd6cec5bd5f718d00671aaea945e0'],
  [246, '619c1344fe0aea90c69f6da136bff6f5abb34b82'],
  [247, 'd708586531e142e1e43a5b7779081bc51629cda9'],
  [248, '0aaede4f30bacf1127ddd1f8fe5c4912bcd7afbc'],
  [249, '2309188b700472111c5f80123fcfd629334b10d7'],
  [250, '29ecf3c430dd8af5d4b36f777bfc444052539274'],
  [251, '4e4f3e6dad56730906b909812157a1a00e46e636'],
  [252, 'b2dadd94cf2d6e980c38edb385124fccad57ca29'],
  [253, '0cd1690a44260e14b5fb650ad1761c2c6d965116'],
  [254, '658e12f914b0074a695aa059a86a03e16220edab'],
  [255, '6d2d03a745c0d3112516ce6e417db40c36938816'],
  [256, '2dd78aa268a667c4bea92f942a7cb09001d40e2f'],
  [257, '84941bc1d5c26e2ec17168cf1f7d779ee772d25f'],
  [258, '5a75d076e46b4d5fc56eef009559bc77d4689944'],
  [259, '683b5f133ef8f1c8b5693dbd05f98194af16458f'],
  [260, 'a7a1cc4eb1f0390b0e0e5a049ed5438b0d7ea786'],
  [261, '45f1b4f2ea054c1f62cd6c45a9f1c0145d8ec29a'],
  [262, 'f79fb05a0adef8261ac643855d6b8179b759da33'],
  [263, '34e30ba0f85e9aabdc7992fa9610b716c7ad0a97'],
  [264, 'cbbb7363a4fa6f70f6716796db5c11c22af1f2f0'],
  [265, '2632298780b554604f6a5926c724aa9ab8e43d6c'],
  [266, '800fdeb303ae09317dcd3a57e2e5b6861e3450c8'],
  [267, '5b0c7c0936d8ee4f3db3d441d07964087be95c3a'],
  [268, 'a3eff15acaa68826fcf8a9313621d81d52dc4285'],
  [269, '9ac0ccac7c820b37f077964f905148a820cc0b2f'],
  [270, 'dab42454719010594d0fedddcd30163a5259aeb1'],
  [271, 'c38e32aa27fdef39816032c1163d2c95fc7a5e35'],
  [272, 'f170a5485f7922156f3f019f44b79bca3702da91'],
  [273, '9cabb5862a4ceff60202f501ccd7c6b026226348'],
  [274, '795c7aec3b5771923921622280979c9ae055bb11'],
  [275, 'df05d70593ef603ba0764784e2737b05629535b1'],
  [276, '631567b28c8b1d0baa1bc7a7df015d39ec10fd9f'],
  [277, '2fb7334a6106fd84668d8becbf1e51101a011d4e'],
]);
ensure(Array.isArray(progress.evidence), 'missing evidence');
ensure(Array.isArray(progress.unverified), 'missing unverified accounting');
const ids = new Set();
const evidenceIds = new Set();
for (const e of progress.evidence) {
  ensure(Number.isInteger(e.pr) && e.pr >= firstPR && e.pr <= lastVerifiedPR && !ids.has(e.pr), 'duplicate/unknown PR');
  ids.add(e.pr);
  evidenceIds.add(e.pr);
  ensure(/^[a-f\d]{40}$/.test(e.sha), 'invalid commit SHA');
  if (lockedRecentHeads.has(e.pr)) ensure(lockedRecentHeads.get(e.pr) === e.sha, 'recent exact-SHA evidence mismatch');
  if (e.pr <= 201) {
    ensure(e.checks === (e.pr === 200 ? 5 : e.pr >= 191 ? 4 :
      e.pr <= 151 ? 6 : e.pr <= 167 || e.pr >= 185 ? 8 : 4), 'inexact check count');
  } else {
    ensure(Number.isInteger(e.checks) && e.checks >= 8 && e.checks <= 64, 'inexact check count');
  }
  ensure(typeof e.scope === 'string' && e.scope.endsWith('-partial'), 'CI is not production acceptance');
}
for (const u of progress.unverified) {
  ensure(Object.keys(u).sort().join(',') === 'pr,reason,sha', 'unverified fields');
  ensure(Number.isInteger(u.pr) && u.pr >= 202 && u.pr <= lastVerifiedPR && !ids.has(u.pr), 'duplicate/unknown unverified PR');
  ids.add(u.pr);
  ensure(/^[a-f\d]{40}$/.test(u.sha), 'invalid unverified SHA');
  ensure(lockedRecentHeads.get(u.pr) === u.sha, 'unverified exact-SHA mismatch');
  ensure(typeof u.reason === 'string' && u.reason.length >= 16, 'unverified reason required');
}
ensure(Array.from({ length: lastVerifiedPR - firstPR + 1 }, (_, index) => firstPR + index)
  .every((pr) => ids.has(pr)),
  'every PR in the evidence window must be accounted for (evidence or unverified)');
ensure(Array.isArray(progress.epicEvidence) && progress.epicEvidence.length === backlog.epics.length,
  'missing epic evidence');
for (const [index, epic] of backlog.epics.entries()) {
  const entry = progress.epicEvidence[index];
  ensure(entry?.id === epic.id && entry.stories === backlog.stories.filter((story) => story.epic === epic.id).length,
    `${epic.id} story allocation mismatch`);
  ensure(entry.acceptedStories === 0, `${epic.id} cannot be production accepted by fixture CI`);
  ensure(Array.isArray(entry.verifiedPartialPRs) && entry.verifiedPartialPRs.length > 0 &&
    entry.verifiedPartialPRs.every((pr) => Number.isInteger(pr) && evidenceIds.has(pr)), `${epic.id} unknown PR proof`);
  ensure(typeof entry.criticalGap === 'string' && entry.criticalGap.length >= 20,
    `${epic.id} missing critical release gap`);
}
ensure(Array.isArray(progress.blockers) && progress.blockers.length >= 5, 'missing release blockers');
console.log(`Progress guard PASS: 9 epics, 54 stories, 66 issues; ${progress.evidence.length} partial PRs + ` +
  `${progress.unverified.length} superseded reds accounted; 5/5 commercial demonstrated, 0 accepted`);
