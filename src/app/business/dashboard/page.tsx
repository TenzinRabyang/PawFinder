import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Building2, Upload, Star, CheckCircle } from 'lucide-react'
import { ReanalyzeButton } from './reanalyze-button'
import { ClaimListingCard } from './claim-listing-card'
import { getWebsiteAnalysisMessage, getWebsiteAnalysisStatus } from '@/lib/website-analysis-status'

function formatList(values: string[] | null | undefined) {
  if (!Array.isArray(values) || values.length === 0) return []
  return values.map((value) =>
    value
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  )
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const resolvedSearchParams = await searchParams

  if (!user) {
    redirect('/login')
  }

  // Get Profile
  const { data: profile } = await supabase
    .from('pf_profiles')
    .select('*, pf_providers(*)')
    .eq('id', user.id)
    .single()

  const provider = profile?.pf_providers

  if (!provider) {
    if (resolvedSearchParams?.claim) {
      return (
        <div className="min-h-screen bg-[#FAF9F6] py-12 px-4">
          <div className="mx-auto max-w-3xl">
            <ClaimListingCard claimId={resolvedSearchParams.claim} />
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-[#FAF9F6] py-12 px-4">
        <div className="mx-auto max-w-3xl rounded-2xl border border-stone-100 bg-white p-6 text-center shadow-sm sm:p-8">
          <Building2 className="w-16 h-16 text-stone-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-stone-800 mb-2">No Business Claimed</h1>
          <p className="text-stone-600 mb-8">You haven't claimed a business profile yet. Go to the search page to find your business and claim it.</p>
          <Link href="/search" className="bg-[#829e8d] text-white px-6 py-2.5 rounded-full font-semibold hover:bg-[#6c8676] transition-colors">
            Find My Business
          </Link>
        </div>
      </div>
    )
  }

  const websiteAnalysisStatus = getWebsiteAnalysisStatus(provider)
  const websiteAnalysisMessage = getWebsiteAnalysisMessage(websiteAnalysisStatus)
  const hasWebsite = Boolean(provider.website?.trim())
  const photoAnalysisCompleted = Array.isArray(provider.breeds_general_inferred) && provider.breeds_general_inferred.length > 0
  const photoAnalysisAttempted = typeof provider.tagging_attempt_count === 'number' && provider.tagging_attempt_count > 0
  const noWebsiteAnalysisTitle = photoAnalysisCompleted
    ? 'Photo Analysis Completed'
    : provider.breed_analysis_exhausted
    ? 'Photo Analysis Exhausted'
    : photoAnalysisAttempted
    ? 'Photo Analysis Retrying'
    : 'Photo Analysis Pending'
  const noWebsiteAnalysisMessage = photoAnalysisCompleted
    ? 'We analyzed this listing’s Google photos and saved broad animal coverage from what was visibly present.'
    : provider.breed_analysis_exhausted
    ? "We checked this listing's Google photos but couldn't confidently confirm an animal type."
    : photoAnalysisAttempted
    ? "We checked this listing's Google photos but haven't confirmed an animal type yet."
    : 'This listing has no website, so PawFinder will fall back to Google photos when they are available.'
  const analysisCardClass = hasWebsite
    ? websiteAnalysisStatus === 'completed'
      ? 'border-[#d9e6dd] bg-[#f3f8f5]'
      : websiteAnalysisStatus === 'fetch_blocked'
      ? 'border-[#eed8cf] bg-[#fff7f3]'
      : 'border-stone-200 bg-stone-50'
    : photoAnalysisCompleted
    ? 'border-[#d9e6dd] bg-[#f3f8f5]'
    : provider.breed_analysis_exhausted
    ? 'border-[#eed8cf] bg-[#fff7f3]'
    : 'border-stone-200 bg-stone-50'
  const serviceLabels = formatList(provider.services)
  const specialisedBreedLabels = formatList(provider.breeds_specialised)
  const inferredCoverageLabels = formatList(provider.breeds_general_inferred)
  const animalLabels = formatList(provider.animals_served)

  return (
    <div className="min-h-screen bg-[#FAF9F6] py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm sm:p-8">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-stone-900 sm:text-3xl">{provider.name}</h1>
              <p className="text-stone-600 mt-1">{provider.address}</p>
              <p className="mt-2 text-sm text-stone-500">
                {provider.ai_tagged_at
                  ? `Last AI ${hasWebsite ? 'website' : 'photo'} analysis: ${new Date(provider.ai_tagged_at).toLocaleString()}`
                  : `AI ${hasWebsite ? 'website' : 'photo'} analysis has not been completed yet.`}
              </p>
            </div>
            <div className="flex flex-col items-start lg:items-end">
              <span className={`px-3 py-1 rounded-full text-sm font-medium uppercase tracking-wide ${
                provider.subscription_tier === 'premium' ? 'bg-yellow-100 text-yellow-800' :
                provider.subscription_tier === 'verified' ? 'bg-green-100 text-green-800' :
                'bg-stone-100 text-stone-600'
              }`}>
                {provider.subscription_tier} Tier
              </span>
              <Link href="/business/subscribe" className="text-sm text-[#e07a5f] hover:underline mt-2 font-medium">
                Manage Subscription &rarr;
              </Link>
            </div>
          </div>

          <div className={`mt-6 rounded-xl border p-5 ${analysisCardClass}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              {hasWebsite ? 'Website Analysis' : 'Photo Analysis'}
            </p>
            <h2 className="mt-2 text-lg font-semibold text-stone-900">
              {hasWebsite
                ? websiteAnalysisStatus === 'completed'
                  ? 'Analysis Completed'
                  : websiteAnalysisStatus === 'fetch_blocked'
                  ? 'Website Access Blocked'
                  : websiteAnalysisStatus === 'skipped_low_content'
                  ? 'Not Enough Readable Website Content'
                  : 'Analysis Needs Attention'
                : noWebsiteAnalysisTitle}
            </h2>
            <p className="mt-2 text-sm text-stone-600">{hasWebsite ? websiteAnalysisMessage : noWebsiteAnalysisMessage}</p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Animals</p>
              <p className="mt-3 text-sm text-stone-700">
                {animalLabels.length > 0 ? animalLabels.join(', ') : 'No animal coverage saved yet.'}
              </p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Services</p>
              <p className="mt-3 text-sm text-stone-700">
                {serviceLabels.length > 0 ? serviceLabels.join(', ') : 'No services saved yet.'}
              </p>
            </div>
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Breed Coverage</p>
              <p className="mt-3 text-sm text-stone-700">
                {specialisedBreedLabels.length > 0
                  ? specialisedBreedLabels.join(', ')
                  : inferredCoverageLabels.length > 0
                  ? `General coverage: ${inferredCoverageLabels.join(', ')}`
                  : 'No breed coverage saved yet.'}
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            <div className="bg-stone-50 p-6 rounded-xl border border-stone-100">
              <Star className="w-8 h-8 text-[#e07a5f] mb-3" />
              <h3 className="font-bold text-stone-900">Reviews</h3>
              <p className="text-stone-600 text-sm mt-1">Manage your native temperament pf_reviews and AI summaries.</p>
              <Link href={`/provider/${encodeURIComponent(provider.google_place_id || provider.id)}`} className="inline-block mt-4 text-sm font-medium text-[#829e8d] hover:underline">View Public Profile</Link>
            </div>
            
            <div className="bg-stone-50 p-6 rounded-xl border border-stone-100 opacity-50 cursor-not-allowed">
              <Upload className="w-8 h-8 text-stone-400 mb-3" />
              <h3 className="font-bold text-stone-900">Photos</h3>
              <p className="text-stone-600 text-sm mt-1">Upload your own photos to Supabase Storage. (Coming Soon)</p>
            </div>

            <div className="bg-stone-50 p-6 rounded-xl border border-stone-100 opacity-50 cursor-not-allowed">
              <CheckCircle className="w-8 h-8 text-stone-400 mb-3" />
              <h3 className="font-bold text-stone-900">Verification</h3>
              <p className="text-stone-600 text-sm mt-1">Submit documents to earn the verified badge. (Coming Soon)</p>
            </div>
          </div>

          <ReanalyzeButton />
        </div>
      </div>
    </div>
  )
}
