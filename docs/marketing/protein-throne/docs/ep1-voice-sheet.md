# The Protein Throne: Episode 1 voice sheet

Purpose: make one voice per character, then use it two ways:
1. A **10-second reference sample** per character, fed to Seedance 2.0 Reference as `Audio 1` so the video speaks in that voice.
2. (Fallback) The **full Episode 1 lines**, for lip-syncing onto the existing silent clips.

All voices: neutral Hindi accent (user's choice), conversational Hinglish, English words (protein, crunch, snacks) said the Indian way. Tags in [brackets] are ElevenLabs v3 delivery tags; voice artists read them as acting notes.

---

## NARRATOR
- **Voice:** deep, slow male, 45 to 55, mythological TV-serial narrator. Grand, over-serious, long dramatic pauses.
- **ElevenLabs Voice Design prompt:** "Deep, resonant Indian male narrator in his late 40s, slow and grand like a mythological TV serial, rich bass, theatrical pauses, neutral Hindi accent, studio quality."
- **Reference sample (10s):** [slow, grand] बहुत समय पहले... एक ऐसा राज्य था... जहाँ सिर्फ़ ताक़त नहीं, स्वाद भी राज करता था।
- **Ep 1 lines**
  - Shot 01: [grand, slow] बहुत समय पहले... Snacks की सल्तनत में... एक ताज था। और एक सिंहासन। Protein का सिंहासन।
  - Shot 06: [dry, knowing] और फिर... वही हुआ जो हर खानदान में होता है।

## MAKHANA
- **Voice:** posh, nasal, delicate adult male, 40s. Over-polite, easily offended, slightly sing-song royal.
- **ElevenLabs Voice Design prompt:** "Posh, nasal, delicate Indian male aristocrat in his 40s, over-polite and snobbish, light airy tone, slightly sing-song, neutral Hindi accent, comedic but refined."
- **Reference sample (10s):** [snooty] अरे, ये क्या बदतमीज़ी है? हम शाही खानदान से हैं... हमसे ऐसे बात नहीं की जाती। [sniffs]
- **Ep 1 lines**
  - Shot 02: [smug, slow] हल्का, शाही और sophisticated. ताज तो ज़ाहिर है... [pause] मेरा ही है।
  - Shot 14: [mocking giggle] यही है challenger? इसे तो कोई चटनी में पीस देगा।

## PEANUT
- **Voice:** loud, booming desi pehelwan, 35 to 45. Proud, rough, warm, laughs a lot, "bhai" in every line.
- **ElevenLabs Voice Design prompt:** "Loud, booming, rough Indian wrestler in his late 30s, proud and boisterous, big belly laugh, chest voice, rustic but warm, neutral Hindi accent."
- **Reference sample (10s):** [laughs] अरे भाई! अखाड़े में आज तक कोई नहीं टिका... मूँगफली की ताक़त है ये, भाई!
- **Ep 1 lines**
  - Shot 03: [booming] अरे भाई! जब protein cool भी नहीं था, तब से हम protein बाँट रहे हैं!
  - Shot 13: [laughing hard] ये? [laughs] ये आया है ताज लेने?

## PROTEIN CHIPS
- **Voice:** flashy filmy superhero, late 20s. Big hero-entry energy, over-the-top announcer swagger.
- **ElevenLabs Voice Design prompt:** "Energetic, flashy young Indian male in his late 20s, filmy superhero swagger, bright confident voice, over-the-top announcer energy, neutral Hindi accent."
- **Reference sample (10s):** [heroic] डरो मत, जनता! मैं आ गया हूँ! क्रंच भी मैं, स्टाइल भी मैं!
- **Ep 1 lines**
  - Shot 04: [cocky] Hello? मेरे तो नाम में ही protein है!

## PROTEIN BAR
- **Voice:** deep, clipped gym coach, 35 to 40. Flat, joyless, zero emotion, short sentences.
- **ElevenLabs Voice Design prompt:** "Deep, flat, clipped Indian male gym coach in his late 30s, emotionless and serious, short punchy delivery, low energy but heavy, neutral Hindi accent."
- **Reference sample (10s):** [flat] Warm-up. Sets. Reps. Discipline. बाकी सब... बहाने हैं।
- **Ep 1 lines**
  - Shot 05: [flat, deadpan] तुम सब snacks हो। [pause] मैं... performance nutrition हूँ।

## CROWN
- **Voice:** echoing, regal, slightly bored, ageless. Slow and judging, like it has seen a thousand challengers.
- **ElevenLabs Voice Design prompt:** "Regal, ageless, slightly bored voice with a grand echo, slow and judging, calm authority, neutral Hindi accent, like an ancient royal artefact speaking."
- **Reference sample (10s):** [bored, regal] कितने आए... कितने गए। सबको लगता है ताज उनका है। ताज किसी का नहीं होता।
- **Ep 1 lines**
  - Shot 09: [slow, final] ताज छीना नहीं जाता। कमाया जाता है। [pause] चार परीक्षाएँ।
- Add a light reverb/echo in post, or ask for it in the Seedance prompt.

## PROMUNCH EDAMAME
- **Voice:** calm, deep baritone, 30s. Deadpan, never raises his voice, every line a mic drop. The SAME voice for the tiny and warrior forms (the joke is a huge voice from a tiny bean).
- **ElevenLabs Voice Design prompt:** "Calm, deep, smooth Indian male baritone in his 30s, deadpan and unbothered, quiet confidence, slow and low, never raises his voice, neutral Hindi accent."
- **Reference sample (10s):** [calm, low] मुझे जल्दी नहीं है। [pause] जो असली होता है... उसे साबित नहीं करना पड़ता।
- **Ep 1 lines**
  - Shot 16: [calm, deadpan] हँस लो। [pause] अभी टाइम है।

---

## Delivery checklist
- Export each reference sample as **MP3 or WAV, 5 to 15 seconds**, one file per character, named `vo-ref-<character>.mp3`.
- Seedance accepts at most 15s of audio per clip, so keep samples short.
- For the fallback path, export each Ep 1 line separately, named `ep1-shotNN-<character>.mp3`.
- Upload to the Studio library, or drop them in the chat.
