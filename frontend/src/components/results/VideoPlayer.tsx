interface VideoPlayerProps {
  src: string;
  poster?: string;
  title?: string;
}

export default function VideoPlayer({ src, poster, title }: VideoPlayerProps) {
  return (
    <div className="space-y-2">
      {title && <h3 className="text-lg font-semibold">{title}</h3>}
      <div className="rounded-xl overflow-hidden bg-black aspect-video">
        <video
          src={src}
          poster={poster}
          controls
          className="w-full h-full object-contain"
          preload="metadata"
        />
      </div>
    </div>
  );
}
