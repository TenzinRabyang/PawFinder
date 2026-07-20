import ProviderProfileClient, {
  type InitialTrustSnapshot,
} from './ProviderProfileClient'
import { CURRENT_AI_VERSION } from '@/lib/trust-eval'
import { createAdminClient } from '@/utils/supabase/admin'

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
}

async function getInitialTrustSnapshot(id: string): Promise<InitialTrustSnapshot | null> {
  const supabaseAdmin = createAdminClient()
  const query = supabaseAdmin
    .from('pf_providers')
    .select('trust_badge, audit_reason, safety_flags, highlights, overall_summary, ai_version')

  const { data } = isUuidLike(id)
    ? await query.eq('id', id).maybeSingle()
    : await query.eq('google_place_id', id).maybeSingle()

  if (
    !data ||
    typeof data.trust_badge !== 'string' ||
    typeof data.audit_reason !== 'string' ||
    typeof data.overall_summary !== 'string' ||
    typeof data.ai_version !== 'number' ||
    data.ai_version < CURRENT_AI_VERSION
  ) {
    return null
  }

  return {
    trust_badge: data.trust_badge as InitialTrustSnapshot['trust_badge'],
    audit_reason: data.audit_reason,
    safety_flags: Array.isArray(data.safety_flags)
      ? data.safety_flags.filter((item): item is string => typeof item === 'string')
      : [],
    highlights: Array.isArray(data.highlights)
      ? data.highlights.filter((item): item is string => typeof item === 'string')
      : [],
    overall_summary: data.overall_summary,
    ai_version: data.ai_version,
    refreshed: false,
  }
}

export default async function ProviderProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const initialTrustSnapshot = await getInitialTrustSnapshot(resolvedParams.id)

  return (
    <ProviderProfileClient
      id={resolvedParams.id}
      initialTrustSnapshot={initialTrustSnapshot}
    />
  )
}
