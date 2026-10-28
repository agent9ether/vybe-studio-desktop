import { db, table } from "./db";
import { generateImage } from "./images";

// AI-artist portfolio + scene generation (ported from the hosted /api/artists routes).

export async function generatePortfolio(body: { artistId: string; basePrompt: string }) {
  if (!db.get("artists", body.artistId)) throw new Error("Artist not found");
  const shots = [
    {
      type: "face_shot",
      prompt: `${body.basePrompt}, close-up studio portrait, headshot, direct gaze, high realism, 8k resolution`,
    },
    {
      type: "side_profile",
      prompt: `${body.basePrompt}, headshot side profile view, high realism, cinematic lighting`,
    },
    {
      type: "full_body",
      prompt: `${body.basePrompt}, standing full body shot, fashion modeling pose, high realism`,
    },
    {
      type: "action_shot",
      prompt: `${body.basePrompt}, action modeling shot, mid-motion posing, realistic environment`,
    },
  ];
  const results = await Promise.all(
    shots.map(async (shot) => {
      const imageUrl = await generateImage(shot.prompt, "artists");
      db.insert("artist_portfolio", {
        artist_id: body.artistId,
        image_url: imageUrl,
        view_type: shot.type,
        is_locked: false,
      });
      return { image_url: imageUrl, view_type: shot.type };
    }),
  );
  return { results };
}

export async function generateScene(body: {
  artistId: string;
  prompt: string;
  clothesUrl?: string;
  carUrl?: string;
}) {
  const artist = db.get("artists", body.artistId);
  if (!artist) throw new Error("Artist not found");
  const portfolio = table("artist_portfolio").filter(
    (p) => p.artist_id === body.artistId && p.view_type === "face_shot",
  );
  const face = portfolio.find((p) => p.is_locked) ?? portfolio[0];
  if (!face)
    throw new Error(
      "No locked face_shot found. Please generate and lock in the 360 portfolio first.",
    );

  let prompt = `Realistic highly detailed professional photo of AI Artist ${artist.name}, described as: ${artist.description || ""}. ${body.prompt}`;
  if (body.clothesUrl)
    prompt += ", wearing the outfit styling matching the provided reference clothing";
  if (body.carUrl)
    prompt +=
      ", posing with or alongside the vehicle scene elements matching the reference background";
  prompt +=
    ", award-winning photography, cinematic lighting, photorealistic character consistency, 8k resolution";

  const imageUrl = await generateImage(prompt, "artists");
  const refs = [];
  if (body.clothesUrl) refs.push({ type: "clothes", url: body.clothesUrl });
  if (body.carUrl) refs.push({ type: "car", url: body.carUrl });
  db.insert("artist_generations", {
    artist_id: body.artistId,
    prompt: body.prompt,
    image_url: imageUrl,
    reference_images: JSON.stringify(refs),
  });
  return { imageUrl };
}
