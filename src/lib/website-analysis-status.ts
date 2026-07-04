import { hasBlockedWebsiteFetch, hasMeaningfulBreedAnalysis } from '@/lib/provider-analysis-state'

export type WebsiteAnalysisStatus = 'completed' | 'fetch_blocked' | 'failed' | 'skipped_low_content'

type WebsiteAnalysisFields = {
  ai_tagged_at?: string | null
  ai_tagging_skipped_low_content?: boolean | null
  tagging_attempt_count?: number | null
  breed_analysis_exhausted?: boolean | null
  animals_served?: string[] | null
  breeds_specialised?: string[] | null
  breeds_general_inferred?: string[] | null
}

export function getWebsiteAnalysisStatus(provider: WebsiteAnalysisFields): WebsiteAnalysisStatus {
  if (hasBlockedWebsiteFetch(provider)) {
    return 'fetch_blocked'
  }

  if (provider.ai_tagged_at && provider.ai_tagging_skipped_low_content && !hasMeaningfulBreedAnalysis(provider)) {
    return 'skipped_low_content'
  }

  if (hasMeaningfulBreedAnalysis(provider) || provider.ai_tagged_at) {
    return 'completed'
  }

  return 'failed'
}

export function getWebsiteAnalysisMessage(status: WebsiteAnalysisStatus) {
  switch (status) {
    case 'completed':
      return 'Website analysis completed and your saved profile details are up to date.'
    case 'fetch_blocked':
      return "We couldn't automatically read your website. This can happen when a site uses bot or firewall protection. You can try reanalyzing later."
    case 'skipped_low_content':
      return "We reached your website, but there wasn't enough readable content to classify it confidently. You can try reanalyzing later or add details manually."
    case 'failed':
    default:
      return "We couldn't complete automatic website analysis this time. You can keep your claimed listing and try reanalyzing again later."
  }
}
