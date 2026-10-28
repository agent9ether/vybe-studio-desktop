// Voices are referenced by their local audio file.
export const preprocessVoice = async ({ data }: { data: { audioUrl: string } }) => ({
  featureId: data.audioUrl,
});
