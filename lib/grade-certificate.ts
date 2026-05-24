import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { drawGradeCompletionCertificate } from '@/lib/certificate-canvas'

export interface GradeCertificateInput {
  userId: string
  schoolYearId: string
  childId: string
  childName: string
  gradeCompleted: string
  gradeAdvancingTo: string | null
  schoolName: string
  schoolYear: string
  completionDate: string
}

export interface GradeCertificateResult {
  childId: string
  childName: string
  gradeCompleted: string
  certificateUrl: string | null
  pngDataUrl: string
}

export async function generateAndStoreCertificate(
  input: GradeCertificateInput
): Promise<GradeCertificateResult> {
  const supabase = createSupabaseBrowserClient()

  // Generate PNG blob
  const blob = await drawGradeCompletionCertificate(
    {
      childName: input.childName,
      gradeCompleted: input.gradeCompleted,
      schoolName: input.schoolName,
      schoolYear: input.schoolYear,
      completionDate: input.completionDate,
    },
    'blob'
  ) as Blob

  // Build storage path: {userId}/{schoolYearId}/{childId}.png
  const path = `${input.userId}/${input.schoolYearId}/${input.childId}.png`

  // Upload to year-certificates bucket
  const { error: uploadError } = await supabase.storage
    .from('year-certificates')
    .upload(path, blob, {
      contentType: 'image/png',
      upsert: true
    })

  let certificateUrl: string | null = null

  if (!uploadError) {
    // Get a long-lived signed URL (10 years)
    const { data: signedData } = await supabase.storage
      .from('year-certificates')
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10)

    certificateUrl = signedData?.signedUrl ?? null

    // Update year_archive_certificates with the URL
    if (certificateUrl) {
      await supabase
        .from('year_archive_certificates')
        .update({ certificate_url: certificateUrl })
        .eq('school_year_id', input.schoolYearId)
        .eq('child_id', input.childId)
    }
  } else {
    console.error('Certificate upload failed:', uploadError)
  }

  // Also return a data URL for immediate display without another round trip
  const reader = new FileReader()
  const pngDataUrl = await new Promise<string>((resolve) => {
    reader.onloadend = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })

  return {
    childId: input.childId,
    childName: input.childName,
    gradeCompleted: input.gradeCompleted,
    certificateUrl,
    pngDataUrl,
  }
}

export async function generateAllCertificatesForYear(
  inputs: GradeCertificateInput[]
): Promise<GradeCertificateResult[]> {
  // Generate sequentially to avoid overwhelming the canvas
  const results: GradeCertificateResult[] = []
  for (const input of inputs) {
    const result = await generateAndStoreCertificate(input)
    results.push(result)
  }
  return results
}
