import { createDb } from "../packages/db/src/index.js";
import { resolveDatabaseTarget } from "../packages/db/src/runtime-config.js";
import {
  listLegacyZeroPersonDiscoverIssueRepairCandidates,
  repairLegacyZeroPersonDiscoverIssues,
} from "../server/src/services/company-blueprint-repairs.js";

type CliOptions = {
  apply: boolean;
  companyId: string | null;
  issueId: string | null;
};

function readOption(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseOptions(argv: string[]): CliOptions {
  return {
    apply: argv.includes("--apply"),
    companyId: readOption(argv, "--company-id"),
    issueId: readOption(argv, "--issue-id"),
  };
}

function formatTimestamp(value: Date | null): string {
  return value ? value.toISOString() : "null";
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const target = resolveDatabaseTarget();
  const connectionString = target.mode === "postgres"
    ? target.connectionString
    : `postgres://paperclip:paperclip@127.0.0.1:${target.port}/paperclip`;
  const db = createDb(connectionString);

  const filters = {
    companyId: options.companyId,
    issueId: options.issueId,
  };
  const candidates = await listLegacyZeroPersonDiscoverIssueRepairCandidates(db, filters);

  console.log(`[repair-zero-person-discover-status] database source: ${target.source}`);
  if (candidates.length === 0) {
    console.log("[repair-zero-person-discover-status] no repair candidates found");
    return;
  }

  console.log(
    `[repair-zero-person-discover-status] found ${candidates.length} repair candidate(s)`,
  );
  for (const candidate of candidates) {
    console.log(
      [
        "-",
        candidate.identifier ?? candidate.issueId,
        `company=${candidate.companyName}`,
        `issueId=${candidate.issueId}`,
        `status=${candidate.status}`,
        `startedAt=${formatTimestamp(candidate.startedAt)}`,
        `heartbeatRuns=${candidate.heartbeatRunCount}`,
        `activityRuns=${candidate.activityRunCount}`,
      ].join(" "),
    );
  }

  if (!options.apply) {
    console.log("[repair-zero-person-discover-status] dry run only; re-run with --apply to persist changes");
    return;
  }

  const result = await repairLegacyZeroPersonDiscoverIssues(db, filters);
  console.log(
    `[repair-zero-person-discover-status] repaired ${result.repairedIssueIds.length} issue(s)`,
  );
  for (const issueId of result.repairedIssueIds) {
    console.log(`  repaired: ${issueId}`);
  }
}

void main().catch((error) => {
  const message = error instanceof Error
    ? `${error.message}${error.stack ? `\n${error.stack}` : ""}`
    : typeof error === "undefined"
      ? "unknown undefined error"
      : JSON.stringify(error);
  console.error(
    `[repair-zero-person-discover-status] failed: ${message}`,
  );
  process.exit(1);
});
