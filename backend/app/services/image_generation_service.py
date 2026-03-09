import urllib.request

import openai

from app.config import settings


def generate_background_image(prompt: str, output_path: str) -> str:
    """Call DALL-E 3 to generate a background image and save to output_path.

    Args:
        prompt: Creative description of the background. Will have safety suffix appended.
        output_path: Where to save the downloaded image.

    Returns:
        output_path on success.

    Raises:
        Exception on failure — let caller decide how to handle.
    """
    safe_prompt = (
        prompt.strip().rstrip(".")
        + ". No text overlays. No human faces. Abstract thematic background only. "
        "Cinematic, high quality, professional photography style."
    )

    client = openai.OpenAI(api_key=settings.openai_api_key)

    response = client.images.generate(
        model="dall-e-3",
        prompt=safe_prompt,
        size="1792x1024",
        quality="standard",
        n=1,
    )

    image_url = response.data[0].url
    urllib.request.urlretrieve(image_url, output_path)
    return output_path
