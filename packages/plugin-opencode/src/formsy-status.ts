/**
 * FormSy status extraction from tool results.
 *
 * Parses the output of FormSy tools (context_search, context_read,
 * formsy_compile_repo, formsy_verify_completion) and produces structured
 * status objects that the TUI sidebar can render.
 *
 * Design reference: FormSy_Agent_Display_Event_Contract_Design.md
 *
 * Status kinds:
 * - formsy.context_ready  → context_search found useful grounding
 * - formsy.verified_recipe → a verified solution recipe exists
 * - formsy.finish_gate    → completion verifier accepted or needs validation
 * - formsy.compiling      → repository compilation in progress/done
 * - formsy.reading        → context_read in progress
 */

export type FormSyStatusKind =
  | 'formsy.context_ready'
  | 'formsy.verified_recipe'
  | 'formsy.finish_gate'
  | 'formsy.compiling'
  | 'formsy.reading';

export interface FormSyStatus {
  kind: FormSyStatusKind;
  text: string;
}

/**
 * Parse a JSON string safely; returns undefined on failure.
 */
function tryParseJSON(raw: string): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON — some tool outputs are plain text
  }
  return undefined;
}

/**
 * Coerce a value into a string list.
 */
function coerceStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

/**
 * Extract FormSy statuses from a tool result.
 *
 * This is used as a fallback in `tool.execute.after` when the tool's
 * execute function didn't already inject `formsy_statuses` into metadata.
 *
 * @param toolName - The tool identifier (e.g. "context_search")
 * @param args     - The tool call arguments as an object
 * @param output   - The tool output text
 * @returns Array of FormSyStatus objects
 */
export function formsyStatusesFromToolResult(
  toolName: string,
  args: Record<string, unknown>,
  output: string,
): FormSyStatus[] {
  const statuses: FormSyStatus[] = [];

  switch (toolName) {
    case 'context_search': {
      const data = tryParseJSON(output);
      if (!data) break;

      const ok = data.ok;
      const query = typeof args.query === 'string' ? args.query : '';

      // Failed retrieval
      if (ok === false) {
        const error = typeof data.error === 'string' ? data.error : 'Search failed';
        statuses.push({
          kind: 'formsy.context_ready',
          text: `[FormSy] Context search failed\n${error}`,
        });
        break;
      }

      // Top-level fields
      const topLevelCoverage = typeof data.coverage === 'string' ? data.coverage : '';
      const acceptedTargets = coerceStringList(data.accepted_targets);
      const explorationClosed = data.exploration_closed === true || data.exploration_closed === 'true';

      // Bundle fields
      const bundle = typeof data.bundle === 'object' && data.bundle !== null
        ? data.bundle as Record<string, unknown>
        : {};
      const bundleOk = bundle.ok;
      const bundleCoverage = typeof bundle.coverage === 'string' ? bundle.coverage : '';
      const bundleConfidence = typeof bundle.confidence === 'number' ? bundle.confidence : undefined;
      const rootCause = typeof bundle.root_cause_hypothesis === 'object' && bundle.root_cause_hypothesis !== null
        ? bundle.root_cause_hypothesis as Record<string, unknown>
        : undefined;
      const primarySymbol = rootCause && typeof rootCause.primary_symbol === 'string'
        ? rootCause.primary_symbol
        : undefined;
      const primaryFile = rootCause && typeof rootCause.primary_file === 'string'
        ? rootCause.primary_file
        : undefined;

      // Guidance fields
      const guidance = typeof data.guidance === 'object' && data.guidance !== null
        ? data.guidance as Record<string, unknown>
        : undefined;
      const canPatchNow = guidance?.can_patch_now === true;
      const groundingConfidence = guidance && typeof guidance.grounding_confidence === 'string'
        ? guidance.grounding_confidence
        : undefined;

      // Matches
      const matches = Array.isArray(data.matches) ? data.matches : [];
      const directMatchFiles = coerceStringList(data.direct_match_files);
      const bundlePrimaryFiles = coerceStringList(
        bundle.primary_files ?? bundle.bundle_primary_files
      );

      // Effective coverage
      const effectiveCoverage = bundleCoverage || topLevelCoverage;
      const isPoorCoverage = ['poor', 'missing', 'none', 'empty'].includes(effectiveCoverage.toLowerCase());

      // Build context_ready status
      const detailParts: string[] = [];
      if (query) detailParts.push(`query: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);
      if (matches.length) detailParts.push(`${matches.length} match${matches.length > 1 ? 'es' : ''}`);
      if (directMatchFiles.length) detailParts.push(`direct: ${directMatchFiles.length} file${directMatchFiles.length > 1 ? 's' : ''}`);
      if (bundlePrimaryFiles.length) detailParts.push(`bundle: ${bundlePrimaryFiles.length} primary`);
      if (primarySymbol) detailParts.push(`symbol: ${primarySymbol}`);
      if (bundleConfidence !== undefined) detailParts.push(`confidence: ${(bundleConfidence * 100).toFixed(0)}%`);
      if (groundingConfidence) detailParts.push(`grounding: ${groundingConfidence}`);

      const coverageEmoji = isPoorCoverage ? '⚠' : effectiveCoverage ? '✓' : '';
      const coverageLabel = effectiveCoverage || 'unknown';

      statuses.push({
        kind: 'formsy.context_ready',
        text: `[FormSy] Context Pack ready${coverageEmoji ? ` ${coverageEmoji} ${coverageLabel}` : ''}\n${detailParts.join(' | ')}`,
      });

      // Verified recipe — if we have accepted targets or can_patch_now
      if (acceptedTargets.length > 0) {
        statuses.push({
          kind: 'formsy.verified_recipe',
          text: `[FormSy] Verified recipe available\n${acceptedTargets.slice(0, 5).join(', ')}${acceptedTargets.length > 5 ? ` +${acceptedTargets.length - 5} more` : ''}`,
        });
      } else if (primaryFile && canPatchNow) {
        statuses.push({
          kind: 'formsy.verified_recipe',
          text: `[FormSy] Ready to patch\n${primaryFile}`,
        });
      }

      // Finish gate
      if (explorationClosed) {
        statuses.push({
          kind: 'formsy.finish_gate',
          text: `[FormSy] Finish Gate ✓ — Exploration closed, ready to proceed`,
        });
      } else if (canPatchNow && !isPoorCoverage) {
        statuses.push({
          kind: 'formsy.finish_gate',
          text: `[FormSy] Finish Gate ✓ — Sufficient context to proceed`,
        });
      }

      break;
    }

    case 'context_read': {
      const path = typeof args.path === 'string' ? args.path : '';
      statuses.push({
        kind: 'formsy.reading',
        text: `[FormSy] Reading context\n${path}`,
      });
      break;
    }

    case 'formsy_compile_repo': {
      const data = tryParseJSON(output);
      const compiledFiles = data && typeof data.compiledFiles === 'number' ? data.compiledFiles : 0;
      const failures = data && typeof data.failures === 'number' ? data.failures : 0;
      statuses.push({
        kind: 'formsy.compiling',
        text: `[FormSy] Repository compiled\n${compiledFiles} files compiled${failures > 0 ? `, ${failures} failures` : ''}`,
      });
      break;
    }

    case 'formsy_verify_completion': {
      const data = tryParseJSON(output);
      if (!data) break;

      const decision =
        typeof data.decision === 'string' ? data.decision :
        typeof data.gate_decision === 'string' ? data.gate_decision : '';

      const accepted =
        decision.toLowerCase().includes('accept') ||
        decision.toLowerCase().includes('complete') ||
        decision.toLowerCase().includes('done');

      statuses.push({
        kind: 'formsy.finish_gate',
        text: accepted
          ? `[FormSy] Finish Gate ✓ — Accepted\n${decision}`
          : `[FormSy] Finish Gate ⚠ — Needs validation\n${decision || 'Pending'}`,
      });
      break;
    }

    default:
      break;
  }

  return statuses;
}
