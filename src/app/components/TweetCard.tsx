import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import nlp from "compromise";
import {
  Heart,
  MessageCircle,
  Repeat2,
  Eye,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Quote,
  Megaphone,
  MessageSquare,
  PenSquare,
} from "lucide-react";

type TweetKind = "tweet" | "repost" | "quote" | "comment";

export interface Token {
  rank: number;
  icon: string;
  name: string;
  match: number;
  marketCap: string;
  volume?: string;
  price?: string;
  returns: string;
  score: number;
  mint?: string | null;
  age?: string;
}

export interface TweetCardProps {
  tweetId?: string | null;
  avatar: string;
  avatarColor: string;
  name: string;
  handle: string;
  time: string;
  tweet: string;
  keywords: string[];
  likes: string;
  retweets: string;
  views: string;
  tokens: Token[];
  narrative: string;
  image?: string;
  onSelect?: () => void;
  isSelected?: boolean;
}

function getTweetKind(keywords: string[]): TweetKind | null {
  const kind = String(keywords[0] ?? "").toLowerCase().trim() as TweetKind;
  if (kind === "tweet" || kind === "repost" || kind === "quote" || kind === "comment") return kind;
  return null;
}

function getTypeIndicator(type: TweetKind | null): { label: string; className: string; icon: ReactNode } | null {
  if (type === "tweet") {
    return {
      label: "Tweet",
      className: "border-zinc-600/70 bg-zinc-800/40 text-zinc-300",
      icon: <PenSquare className="h-3 w-3" />,
    };
  }
  if (type === "repost") {
    return {
      label: "Repost",
      className: "border-emerald-500/35 bg-emerald-500/15 text-emerald-300",
      icon: <Megaphone className="h-3 w-3" />,
    };
  }
  if (type === "quote") {
    return {
      label: "Quote",
      className: "border-amber-500/35 bg-amber-500/15 text-amber-300",
      icon: <Quote className="h-3 w-3" />,
    };
  }
  if (type === "comment") {
    return {
      label: "Comment",
      className: "border-sky-500/35 bg-sky-500/15 text-sky-300",
      icon: <MessageSquare className="h-3 w-3" />,
    };
  }
  return null;
}

function renderTweetText(text: string, keywords: string[]): ReactNode[] {
  const normalizedKeywords = keywords.map((k) => k.toLowerCase().trim()).filter(Boolean);
  const nounSet = new Set(
    nlp(text)
      .nouns()
      .out("array")
      .map((noun: string) => noun.toLowerCase().trim())
      .filter(Boolean)
  );

  const segments = text.split(/(\s+)/);

  return segments.map((segment, index) => {
    if (/^\s+$/.test(segment)) {
      return <span key={`space-${index}`}>{segment}</span>;
    }

    const mentionMatch = segment.match(/^@([A-Za-z0-9_]{1,15})([.,!?;:]*)$/);
    if (mentionMatch) {
      const username = mentionMatch[1];
      const trailing = mentionMatch[2] ?? "";
      return (
        <span key={`mention-${index}`}>
          <a
            href={`https://x.com/${username}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-sky-400 hover:text-sky-300 underline underline-offset-2"
          >
            @{username}
          </a>
          {trailing}
        </span>
      );
    }

    const cleaned = segment.replace(/^[^A-Za-z0-9$#]+|[^A-Za-z0-9$#]+$/g, "");
    const normalized = cleaned.toLowerCase();
    const isKeyword = normalizedKeywords.includes(normalized);
    const isNoun = nounSet.has(normalized);

    if (isKeyword || isNoun) {
      return (
        <span
          key={`hl-${index}`}
          className={`${isKeyword ? "font-bold text-sky-400" : ""} ${isNoun ? "rounded-sm bg-emerald-400/15 px-1" : ""}`.trim()}
        >
          {segment}
        </span>
      );
    }

    return <span key={`text-${index}`}>{segment}</span>;
  });
}

const TOKEN_PILL_COLORS: Record<string, string> = {
  $DOGE: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  $PEPE: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  $ELON: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  $ARB: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  $OP: "bg-red-500/10 text-red-400 border-red-500/30",
  $STRK: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  $APE: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
};

function getTokenPillColor(name: string): string {
  return TOKEN_PILL_COLORS[name] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
}

export function TweetCard({
  tweetId,
  avatar,
  avatarColor,
  name,
  handle,
  time,
  tweet,
  keywords,
  likes,
  retweets,
  views,
  tokens,
  narrative,
  image,
  onSelect,
  isSelected = false,
}: TweetCardProps) {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);
  const tweetType = getTweetKind(keywords);
  const highlightableKeywords = tweetType ? keywords.slice(1) : keywords;
  const suggestedName = tokens[0]?.name?.trim() || narrative.replace(/\s+/g, "").slice(0, 12).toUpperCase() || "TOKEN";
  const tweetBody = useMemo(() => renderTweetText(tweet, highlightableKeywords), [tweet, highlightableKeywords]);
  const handleUsername = handle.replace(/^@/, "");
  const cardVariantClass = tweetType === "repost" ? "bg-emerald-500/10 border-emerald-500/25" : "";
  const typeIndicator = getTypeIndicator(tweetType);
  const isVideoMedia = Boolean(image && /\.(mp4|webm|mov)(\?|$)/i.test(image));

  return (
    <article
      onClick={onSelect}
      className={`rounded-xl border transition-all duration-300 cursor-pointer overflow-hidden mb-3 relative ${
        isSelected
          ? "border-[#00FFA3]/80 bg-[#0B0F17]/95 shadow-[0_0_30px_rgba(0,255,163,0.12),inset_0_1px_0_rgba(0,255,163,0.1)]"
          : `border-[#1a1f2e]/80 bg-[#0B0F17]/60 hover:border-[#242b3d] hover:bg-[#0B0F17]/80 hover:shadow-[0_0_20px_rgba(0,255,163,0.03)] ${cardVariantClass}`
      }`}
    >
      {isSelected && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#00FFA3] shadow-[0_0_12px_rgba(0,255,163,0.6)]" />
      )}

      {tweetType === "comment" ? (
        <div className="flex items-center gap-2 px-4 pt-3 text-zinc-500">
          <span className="h-5 w-px bg-zinc-600" />
          <MessageCircle className="h-3.5 w-3.5" />
        </div>
      ) : null}

      <div className="p-4">
        {tweetType === "repost" ? (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-emerald-300/85">
            <GitBranch className="h-3 w-3" />
            <span>@{handleUsername} reposted</span>
          </div>
        ) : null}

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
              style={{ backgroundColor: avatarColor, color: "#0C447C" }}
            >
              {avatar}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-white text-[15px]">{name}</span>
              <a
                href={`https://x.com/${handleUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-zinc-500 text-[15px] hover:text-zinc-300 underline underline-offset-2"
              >
                {handle}
              </a>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-500 text-sm">{time}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {typeIndicator ? (
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold ${typeIndicator.className}`}>
                {typeIndicator.icon}
                {typeIndicator.label}
              </span>
            ) : null}
            {tweetId && handle ? (
              <a
                href={`https://x.com/${handleUsername}/status/${tweetId}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on X"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-center h-6 w-6 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>

        <div className="my-3 border-t border-[#1a1f2e]/70" />

        <div className="text-[15px] leading-normal text-zinc-200 mb-3 whitespace-pre-wrap">{tweetBody}</div>

        {tweetType === "quote" ? (
          <div className="mb-3 rounded-lg border border-zinc-700/70 bg-zinc-900/55 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-[10px] font-semibold text-zinc-200">
                ?
              </span>
              <span className="font-medium">Quoted post</span>
            </div>
          </div>
        ) : null}

        {tokens.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {tokens.map((token) => (
              <span
                key={token.name}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border ${getTokenPillColor(token.name)}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                {token.name}
              </span>
            ))}
          </div>
        ) : null}

        {image ? (
          <div className="mb-3 rounded-xl overflow-hidden border border-[#1a1f2e]/60 max-h-64">
            {isVideoMedia ? (
              <video src={image} controls playsInline preload="metadata" className="w-full h-full object-cover" />
            ) : (
              <img src={image} alt="" className="w-full h-full object-cover" />
            )}
          </div>
        ) : null}

        <div className="mt-3 mb-3 border-t border-[#1a1f2e]/70" />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-5 text-[#5a6078]">
            <div className="flex items-center gap-1.5 text-sm hover:text-[#00FFA3] transition-colors group cursor-pointer">
              <Heart className="w-4 h-4 group-hover:scale-110 transition-transform" />
              <span>{likes}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm hover:text-[#00FFA3] transition-colors group cursor-pointer">
              <Repeat2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
              <span>{retweets}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm hover:text-[#00d4ff] transition-colors group cursor-pointer">
              <MessageCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />
            </div>
            <div className="flex items-center gap-1.5 text-sm hover:text-white transition-colors group cursor-pointer">
              <Eye className="w-4 h-4 group-hover:scale-110 transition-transform" />
              <span>{views}</span>
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate("/tokenize", { state: { narrative, suggestedName } });
            }}
            className="bg-[#00FFA3] hover:bg-[#33ffb5] text-black font-bold rounded-md transition-colors active:translate-y-[1px] px-4 py-1.5 text-xs border border-[#00FFA3]"
          >
            Tokenize
          </button>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded((s) => !s);
          }}
          className="md:hidden mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-[#1a1f2e] bg-[#05070B]/60 py-1.5 text-xs font-bold text-[#8b92a8] transition-all hover:border-[#242b3d] hover:text-white"
        >
          {isExpanded ? (
            <>
              Hide tokens <ChevronUp className="h-3 w-3" />
            </>
          ) : (
            <>
              Show tokens <ChevronDown className="h-3 w-3" />
            </>
          )}
        </button>

        {isExpanded && (
          <div className="md:hidden mt-3 space-y-2 border-t border-[#1a1f2e]/70 pt-3">
            {tokens.length > 0 ? (
              tokens.map((token) => (
                <div
                  key={token.name}
                  className="flex items-center justify-between rounded-lg border border-[#1a1f2e] bg-[#05070B]/60 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border ${getTokenPillColor(token.name)}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                      {token.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <div className="text-right">
                      <div className="text-[10px] text-[#5a6078]">MCap</div>
                      <div className="font-bold text-white">{token.marketCap}</div>
                    </div>
                    {token.price ? (
                      <div className="text-right">
                        <div className="text-[10px] text-[#5a6078]">Price</div>
                        <div className="font-bold text-white">{token.price}</div>
                      </div>
                    ) : null}
                    <div className="text-right">
                      <div className="text-[10px] text-[#5a6078]">Score</div>
                      <div className="font-bold text-[#00FFA3]">{token.score}</div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-xs text-[#5a6078] py-2">No tokens yet for this tweet.</div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
