export type CoveragePhase = "voice" | "closeup" | "lipsync";

export type CoverageLineStatus =
  | "pending"
  | "reusing"
  | "generating"
  | "complete"
  | "failed"
  | "canceled";

/**
 * The line fields needed by the runner. A caller can map any screenplay line
 * shape to this identity without importing provider or project types here.
 */
export interface CoverageLineIdentity {
  readonly sceneNumber: number;
  readonly lineId: string;
  readonly order: number;
  readonly speaker?: string;
  readonly characterId?: string;
}

export interface CoverageLineProgress {
  readonly sceneNumber: number;
  readonly lineId: string;
  readonly order: number;
  readonly speaker?: string;
  readonly characterId?: string;
  readonly phase: CoveragePhase;
  readonly status: CoverageLineStatus;
  readonly error?: string;
}

/**
 * Assets can have different provider-specific shapes in each phase. The
 * runner only needs to know whether a current READY asset exists.
 */
export interface CoverageAssetMap {
  readonly voice: unknown;
  readonly closeup: unknown;
  readonly lipsync: unknown;
}

export interface SceneCoverageDependencies<
  TLine,
  TAssets extends CoverageAssetMap = CoverageAssetMap,
> {
  /** Extract the stable identity shown in progress updates from one line. */
  readonly getLineIdentity: (line: TLine) => CoverageLineIdentity;

  /** Return only the exact current READY asset, or null when coverage is missing. */
  readonly resolveCurrentAsset: <TPhase extends CoveragePhase>(
    line: TLine,
    phase: TPhase
  ) => Promise<TAssets[TPhase] | null>;

  /** Ensure one phase and return the provider's authoritative resulting asset. */
  readonly ensureAsset: <TPhase extends CoveragePhase>(
    line: TLine,
    phase: TPhase,
    currentAsset: TAssets[TPhase] | null
  ) => Promise<TAssets[TPhase]>;

  /** Return false when the selected scene/run has become stale or was canceled. */
  readonly isCurrent: () => boolean | Promise<boolean>;

  /** Receives a complete immutable progress snapshot after each transition. */
  readonly onProgress: (progress: readonly CoverageLineProgress[]) => void;
}

export type SceneCoverageRunStatus = "complete" | "failed" | "canceled";

export interface SceneCoverageRunResult {
  readonly status: SceneCoverageRunStatus;
  /** The final immutable snapshot, including untouched lines after a stop. */
  readonly progress: readonly CoverageLineProgress[];
  readonly error?: string;
}

const COVERAGE_PHASES: readonly CoveragePhase[] = ["voice", "closeup", "lipsync"];
const CANCELED_MESSAGE =
  "Coverage run canceled because the active scene or run is no longer current.";

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return "An unexpected error occurred.";
}

function formatStageError(
  identity: CoverageLineIdentity,
  phase: CoveragePhase,
  error: unknown
): string {
  return `Line ${identity.lineId} ${phase} coverage failed: ${errorDetail(error)}`;
}

function cloneSnapshot(
  progress: readonly CoverageLineProgress[]
): readonly CoverageLineProgress[] {
  const entries = progress.map((entry) => Object.freeze({ ...entry }));
  return Object.freeze(entries);
}

/**
 * Run every coverage phase in the supplied array order.
 *
 * The provider callbacks own exact lineage checks and persistence. This
 * function only sequences them, re-resolving after generation so a later
 * phase never relies on an older asset ID or URL.
 */
export async function runSceneCoverage<
  TLine,
  TAssets extends CoverageAssetMap = CoverageAssetMap,
>(
  lines: readonly TLine[],
  deps: SceneCoverageDependencies<TLine, TAssets>
): Promise<SceneCoverageRunResult> {
  let identities: CoverageLineIdentity[] = [];
  let progress: CoverageLineProgress[] = [];
  let activeIndex = -1;
  let activePhase: CoveragePhase = "voice";

  const snapshot = (): readonly CoverageLineProgress[] =>
    cloneSnapshot(progress);

  const notify = (): void => {
    deps.onProgress(snapshot());
  };

  const update = (
    index: number,
    patch: Pick<CoverageLineProgress, "phase" | "status"> &
      Partial<Pick<CoverageLineProgress, "error">>
  ): void => {
    progress = progress.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, ...patch } : entry
    );
    notify();
  };

  const canceled = (index: number, phase: CoveragePhase): SceneCoverageRunResult => {
    if (index >= 0 && index < progress.length) {
      update(index, {
        phase,
        status: "canceled",
        error: CANCELED_MESSAGE,
      });
    }

    return {
      status: "canceled",
      progress: snapshot(),
      error: CANCELED_MESSAGE,
    };
  };

  try {
    // Resolve identities once, but deliberately never sort or rewrite the lines.
    for (let index = 0; index < lines.length; index += 1) {
      activeIndex = index;
      identities.push(deps.getLineIdentity(lines[index]));
    }

    progress = identities.map((identity) => ({
      sceneNumber: identity.sceneNumber,
      lineId: identity.lineId,
      order: identity.order,
      ...(identity.speaker === undefined ? {} : { speaker: identity.speaker }),
      ...(identity.characterId === undefined
        ? {}
        : { characterId: identity.characterId }),
      phase: "voice" as const,
      status: "pending" as const,
    }));
    activeIndex = lines.length > 0 ? 0 : -1;
    notify();

    for (let index = 0; index < lines.length; index += 1) {
      activeIndex = index;
      const line = lines[index];

      if (!(await deps.isCurrent())) {
        return canceled(index, "voice");
      }

      for (let phaseIndex = 0; phaseIndex < COVERAGE_PHASES.length; phaseIndex += 1) {
        const phase = COVERAGE_PHASES[phaseIndex];
        activePhase = phase;

        if (!(await deps.isCurrent())) {
          return canceled(index, phase);
        }

        const currentAsset = await deps.resolveCurrentAsset(line, phase);

        // Resolution is asynchronous too, so a stale result must not update UI
        // or allow an ensure callback to start for the old scene.
        if (!(await deps.isCurrent())) {
          return canceled(index, phase);
        }

        if (currentAsset !== null && currentAsset !== undefined) {
          update(index, { phase, status: "reusing" });
        } else {
          if (!(await deps.isCurrent())) {
            return canceled(index, phase);
          }

          update(index, { phase, status: "generating" });
          const ensuredAsset = await deps.ensureAsset(line, phase, currentAsset);

          if (ensuredAsset === null || ensuredAsset === undefined) {
            throw new Error("the ensure operation did not return an asset");
          }

          if (!(await deps.isCurrent())) {
            return canceled(index, phase);
          }

          // The ensure result is intentionally not threaded forward. A fresh
          // lookup is the authority for IDs and URLs written by the provider.
          const authoritativeAsset = await deps.resolveCurrentAsset(line, phase);
          if (authoritativeAsset === null || authoritativeAsset === undefined) {
            throw new Error("coverage did not become READY after generation");
          }

          if (!(await deps.isCurrent())) {
            return canceled(index, phase);
          }

          update(index, { phase, status: "reusing" });
        }

        if (!(await deps.isCurrent())) {
          return canceled(index, phase);
        }

        if (phaseIndex === COVERAGE_PHASES.length - 1) {
          update(index, { phase, status: "complete" });

          if (!(await deps.isCurrent())) {
            return canceled(index, phase);
          }
        } else {
          update(index, {
            phase: COVERAGE_PHASES[phaseIndex + 1],
            status: "pending",
          });
        }
      }
    }

    return {
      status: "complete",
      progress: snapshot(),
    };
  } catch (error) {
    const identity = identities[activeIndex];
    const message = identity
      ? formatStageError(identity, activePhase, error)
      : `Scene coverage failed: ${errorDetail(error)}`;

    if (activeIndex >= 0 && activeIndex < progress.length) {
      progress = progress.map((entry, index) =>
        index === activeIndex
          ? {
              ...entry,
              phase: activePhase,
              status: "failed",
              error: message,
            }
          : entry
      );

      // A progress observer should not be able to hide the provider error from
      // the returned result if it throws while receiving the failure snapshot.
      try {
        notify();
      } catch {
        // The original stage error remains the result returned to the caller.
      }
    }

    return {
      status: "failed",
      progress: snapshot(),
      error: message,
    };
  }
}
