import { TrendingUp, MessageCircle } from "lucide-react";

const mockCreators = [
  {
    avatar: "MR",
    avatarColor: "#B5D4F4",
    name: "Murad",
    handle: "@murad_m",
    followers: "284K",
    narratives: 12,
    topToken: "RWASOLANA",
    performance: "+840%",
  },
  {
    avatar: "AB",
    avatarColor: "#F5C4B3",
    name: "ansem",
    handle: "@blknoiz06",
    followers: "198K",
    narratives: 8,
    topToken: "DEPINGEN",
    performance: "+190%",
  },
  {
    avatar: "KT",
    avatarColor: "#9FE1CB",
    name: "kaito",
    handle: "@kaitoai",
    followers: "156K",
    narratives: 15,
    topToken: "AIAGENT",
    performance: "+320%",
  },
  {
    avatar: "CB",
    avatarColor: "#FAC775",
    name: "cobie",
    handle: "@cobie",
    followers: "312K",
    narratives: 6,
    topToken: "EIGENLAYER",
    performance: "+520%",
  },
];

export function CreatorsPage() {
  return (
    <div className="flex flex-col h-full bg-black">
      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {mockCreators.map((creator, index) => (
          <div
            key={index}
            className="bg-white border border-gray-200 rounded-2xl p-4 hover:border-gray-400 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
          >
            <div className="flex items-start gap-3 mb-3">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-lg border-2 border-white"
                style={{
                  backgroundColor: creator.avatarColor,
                  color: "#0C447C",
                }}
              >
                {creator.avatar}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-gray-800">
                    {creator.name}
                  </span>
                  <span className="text-xs text-gray-500">
                    {creator.handle}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-600 font-medium">
                  <div className="flex items-center gap-1">
                    <MessageCircle className="w-3 h-3" />
                    {creator.followers}
                  </div>
                  <div className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full border border-gray-300">
                    {creator.narratives} narratives
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-600 font-medium">
                  Top Token
                </span>
                <div className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-green-600" />
                  <span className="text-xs font-bold text-green-600">
                    {creator.performance}
                  </span>
                </div>
              </div>
              <div className="text-sm font-bold text-gray-900">
                {creator.topToken}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}