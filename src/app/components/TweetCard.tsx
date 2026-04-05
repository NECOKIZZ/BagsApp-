import { useState } from "react";
import { useNavigate } from "react-router";
import { Heart, MessageCircle, Eye, ChevronDown } from "lucide-react";

interface Token {
  rank: number;
  icon: string;
  name: string;
  match: number;
  marketCap: string;
  returns: string;
  score: number;
}

export interface TweetCardProps {
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
  initiallyExpanded?: boolean;
  onTokenize?: (narrative: string, suggestedName: string) => void;
}

function highlightKeywords(text: string, keywords: string[]) {
  let result = text;
  keywords.forEach((keyword) => {
    const regex = new RegExp(`\\b(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "gi");
    result = result.replace(regex, '<span class="font-bold text-sky-400">$1</span>');
  });
  return result;
}

export function TweetCard({
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
  initiallyExpanded = false,
  onTokenize,
}: TweetCardProps) {
  const [isTokensExpanded, setIsTokensExpanded] = useState(initiallyExpanded);
  const navigate = useNavigate();

  const fromNarrative = narrative.replace(/\s+/g, "").slice(0, 12).toUpperCase();
  const suggestedName = tokens[0]?.name?.trim() || fromNarrative || "TOKEN";

  return (
    <div className="relative mb-4 md:mb-6">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-zinc-600/20 via-zinc-400/15 to-zinc-600/20 rounded-3xl blur-sm pointer-events-none" />
      <div className="relative bg-zinc-950 border border-zinc-700 rounded-2xl md:rounded-3xl overflow-hidden transition-all hover:border-zinc-500">
        <div className="p-4 md:p-6">
          <div className="flex items-center gap-3 mb-3 md:mb-4">
            <div
              className="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center text-sm md:text-base font-semibold flex-shrink-0 shadow-lg"
              style={{ backgroundColor: avatarColor, color: "#0C447C" }}
            >
              {avatar}
            </div>
            <div className="flex flex-col gap-0.5 md:gap-1 flex-1 min-w-0">
              <span className="text-base md:text-lg font-bold text-white truncate">{name}</span>
              <button
                type="button"
                onClick={() => navigate("/profile")}
                className="text-xs md:text-sm text-zinc-400 hover:text-sky-400 truncate text-left transition-colors"
              >
                {handle}
              </button>
            </div>
            <span className="text-xs md:text-sm bg-zinc-900 px-2 md:px-3 py-1 md:py-1.5 rounded-full border border-zinc-800 text-zinc-400 whitespace-nowrap">
              {time}
            </span>
          </div>
          <div
            className="text-sm md:text-base leading-relaxed text-zinc-300 mb-3 md:mb-4"
            dangerouslySetInnerHTML={{ __html: highlightKeywords(tweet, keywords) }}
          />
          {image ? (
            <div className="mb-3 md:mb-4 rounded-xl md:rounded-2xl overflow-hidden border border-zinc-700">
              <img
                src={image}
                alt=""
                className="w-full h-auto max-h-[300px] md:max-h-[400px] object-cover"
              />
            </div>
          ) : null}
          <div className="flex gap-4 md:gap-6">
            <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm text-pink-500 font-semibold">
              <Heart className="w-3.5 h-3.5 md:w-4 md:h-4" fill="currentColor" />
              {likes}
            </div>
            <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm text-sky-500 font-semibold">
              <MessageCircle className="w-3.5 h-3.5 md:w-4 md:h-4" />
              {retweets}
            </div>
            <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm font-semibold text-white">
              <Eye className="w-3.5 h-3.5 md:w-4 md:h-4" />
              {views}
            </div>
          </div>
        </div>
        <div className="px-4 md:px-6 py-3 md:py-4 border-t border-zinc-800 flex items-center gap-2 md:gap-3 flex-wrap">
          <button
            type="button"
            onClick={() =>
              onTokenize
                ? onTokenize(narrative, suggestedName)
                : navigate("/tokenize", { state: { narrative } })
            }
            className="px-4 md:px-6 py-2 md:py-3 text-sm md:text-base font-bold bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-all shadow-[0_4px_14px_0_rgba(16,185,129,0.45)] hover:shadow-[0_6px_20px_rgba(16,185,129,0.55)] hover:scale-[1.02] active:scale-[0.98]"
          >
            Tokenize
          </button>
          <button
            type="button"
            onClick={() => setIsTokensExpanded(!isTokensExpanded)}
            className={`flex items-center gap-2 px-3 md:px-5 py-2 md:py-3 text-sm md:text-base font-bold rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] ${
              isTokensExpanded
                ? "bg-white text-black"
                : "bg-zinc-900 text-white border-2 border-zinc-700"
            }`}
          >
            Tokens ({tokens.length})
            <ChevronDown
              className={`w-3.5 h-3.5 md:w-4 md:h-4 transition-transform ${isTokensExpanded ? "rotate-180" : ""}`}
            />
          </button>
          {tokens.length === 0 ? (
            <div className="flex items-center gap-2 px-3 md:px-4 py-1.5 md:py-2 rounded-xl bg-amber-500/10 text-xs md:text-sm font-semibold text-amber-400 border border-amber-500/30">
              No tokens yet
            </div>
          ) : null}
        </div>
        {isTokensExpanded ? (
          <div className="border-t border-zinc-800 bg-zinc-900/40">
            {tokens.length > 0 ? (
              <>
                <div className="px-3 md:px-4 py-2 flex items-center justify-between border-b border-zinc-800/80">
                  <span className="text-xs text-zinc-500 tracking-wide font-semibold">MATCHED TOKENS</span>
                  <span className="text-xs text-zinc-600 hidden md:inline">≥75% keyword match</span>
                </div>
                <div className="overflow-x-auto">
                  {tokens.slice(0, 5).map((token) => (
                    <div
                      key={token.rank}
                      className="flex items-center gap-3 md:gap-4 px-4 md:px-5 py-3.5 md:py-4 border-t border-zinc-800 bg-zinc-950 hover:bg-zinc-900/80 transition-colors"
                    >
                      <div
                        className="w-8 h-8 md:w-9 md:h-9 rounded-full text-xs font-medium flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor:
                            token.rank === 1
                              ? "#EEEDFE"
                              : token.rank === 2
                                ? "#E1F5EE"
                                : token.rank === 3
                                  ? "#FAECE7"
                                  : token.rank === 4
                                    ? "#FAEEDA"
                                    : "#FBEAF0",
                          color:
                            token.rank === 1
                              ? "#3C3489"
                              : token.rank === 2
                                ? "#085041"
                                : token.rank === 3
                                  ? "#712B13"
                                  : token.rank === 4
                                    ? "#633806"
                                    : "#72243E",
                        }}
                      >
                        {token.icon}
                      </div>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => navigate(`/token/${encodeURIComponent(token.name.toLowerCase())}`)}
                          className="text-sm md:text-base font-medium text-white text-left hover:text-sky-400 transition-colors truncate"
                        >
                          {token.name}
                        </button>
                        <span className="text-[10px] md:text-xs font-semibold text-emerald-400/90 shrink-0 px-1.5 py-0.5 rounded-md bg-emerald-500/10">
                          {token.match}%
                        </span>
                        <span
                          className="text-sm md:text-base font-bold flex-shrink-0 tabular-nums"
                          style={{
                            color:
                              token.score >= 60 ? "#22c55e" : token.score >= 25 ? "#f97316" : "#ef4444",
                          }}
                        >
                          {token.score}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs text-zinc-500">MC:</span>
                        <span className="text-sm md:text-base text-white font-medium">{token.marketCap}</span>
                      </div>
                      <span
                        className={`text-xs md:text-sm font-semibold w-14 text-right shrink-0 ${
                          token.returns.trim().startsWith("-") ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {token.returns}
                      </span>
                      <button
                        type="button"
                        className="px-4 md:px-5 py-2 md:py-2.5 text-sm md:text-base font-bold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-all shadow-[0_2px_8px_0_rgba(16,185,129,0.35)] flex-shrink-0"
                      >
                        Buy
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-zinc-400 mb-1">No tokens launched for this narrative yet.</p>
                <p className="text-xs text-zinc-600">Be the first — click Tokenize above.</p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
