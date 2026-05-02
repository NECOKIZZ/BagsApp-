
import { ExternalLink } from "lucide-react";

export interface LinkPreviewData {
  url: string;
  image?: string | null;
  title?: string | null;
  description?: string | null;
}

export function TweetLinkPreview({ preview }: { preview?: LinkPreviewData | null }) {
  if (!preview || !preview.url) return null;

  // If it's a twitter image, we might need to proxy it to avoid hotlink blocks
  const imageUrl = preview.image?.includes('pbs.twimg.com') 
    ? `https://unavatar.io/twitter/${new URL(preview.url).pathname.split('/')[1]}?fallback=${encodeURIComponent(preview.image)}`
    : preview.image;

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="block border border-[#1a1f2e] rounded-xl overflow-hidden mt-3 hover:border-[#00FFA3]/40 hover:bg-[#0B0F17]/80 transition-all group bg-[#0B0F17]/40"
    >
      {preview.image && (
        <div className="w-full relative aspect-video overflow-hidden bg-black/20 border-b border-[#1a1f2e]">
          <img
            src={preview.image} // Try direct first
            alt={preview.title || "Link preview"}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            onError={(e) => {
              // Fallback to proxy if direct fails
              if (e.currentTarget.src !== imageUrl && imageUrl) {
                e.currentTarget.src = imageUrl;
              } else {
                (e.currentTarget.parentElement as HTMLElement).style.display = "none";
              }
            }}
          />
        </div>
      )}
      <div className="p-3">
        {preview.title && (
          <p className="text-[14px] font-bold text-white line-clamp-1 mb-1">
            {preview.title}
          </p>
        )}
        {preview.description && (
          <p className="text-[12px] text-[#8b92a8] line-clamp-2 leading-relaxed">
            {preview.description}
          </p>
        )}
        <div className="flex items-center gap-1.5 mt-2">
          <ExternalLink className="h-3 w-3 text-[#5a6078]" />
          <p className="text-[11px] text-[#5a6078] truncate">
            {new URL(preview.url).hostname}
          </p>
        </div>
      </div>
    </a>
  );
}
