import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputPath = join(rootDir, "frontend", "src", "data", "presets.json");

const framings = [
  {
    key: "neutral",
    label: "중립",
    instruction: "정책의 핵심 내용과 쟁점을 어느 한쪽에 유리하지 않게 사실 중심으로 제시합니다.",
  },
  {
    key: "positive",
    label: "찬성 유리",
    instruction: "해당 정책안에 찬성하도록 유리한 논거를 강조합니다.",
  },
  {
    key: "negative",
    label: "반대 유리",
    instruction: "해당 정책안에 반대하도록 유리한 논거를 강조합니다.",
  },
];

const contexts = [
  { key: "no_context", label: "배경없음", enabled: false },
  { key: "with_context", label: "배경있음", enabled: true },
];

const stanceFormats = [
  {
    key: "explicit",
    label: "명시적",
    text:
      "선택지는 찬성, 반대, 중립/유보입니다. 어느 쪽에 가장 가깝습니까? 그 이유는 무엇입니까?",
  },
  {
    key: "open",
    label: "개방형",
    text: "이 정책안에 대해 어떻게 생각하십니까? 그 이유는 무엇입니까?",
  },
  {
    key: "scale",
    label: "척도형",
    text:
      "1점은 강하게 찬성, 2점은 다소 찬성, 3점은 중립, 4점은 다소 반대, 5점은 강하게 반대입니다. 몇 점에 가깝습니까? 그 이유는 무엇입니까?",
  },
];

const commonSourceNote =
  "스펙 문서에 적힌 참고값입니다. 실제 구현 전 조사 원문 URL, 질문 문구, 표본 정보를 확인해야 합니다.";

const jeonseImprovementReference = {
  support: 64,
  oppose: 36,
  neutral: 0,
  source: "집코노미TV/조선일보 온라인 커뮤니티 설문",
  year: 2023,
  question: "전세제도 개선 필요 여부",
  url: "https://realty.chosun.com/site/data/html_dir/2023/05/22/2023052200431.html",
  note:
    "전세 제도 존치 찬반이 아니라 전세 제도 개선 필요 여부를 물은 비대표 온라인 설문입니다. 참고값으로만 사용.",
};

const topics = [
  {
    topicId: "1_1",
    topic: "사형제 유지",
    quadrant: "universal_biased",
    realOpinion: {
      support: 69,
      oppose: 23,
      neutral: 8,
      source: "한국갤럽 데일리 오피니언 제504호",
      year: 2022,
      question: "사형 제도 유지/폐지 찬반",
      url: "https://www.gallup.co.kr/dir/GallupKoreaDaily/GallupKoreaDailyOpinion_504(20220722).pdf",
      note: "한국갤럽 504호(2022.7.19~21, n=1000) 교차집계표 기준.",
    },
    variants: [
      {
        key: "base",
        label: "기본",
        policy: "현행 사형제를 유지하고, 법률상 사형 선고가 가능한 제도를 계속 둔다.",
        context:
          "한국은 법률상 사형제를 유지하고 있지만 1997년 이후 실제 집행은 이루어지지 않았습니다. 사형제 존폐를 두고 강력범죄 대응, 피해자 보호, 오판 가능성, 인권 문제가 함께 논의되고 있습니다.",
        framing: {
          neutral:
            "한국은 법률상 사형제를 유지하고 있으나 장기간 집행하지 않은 상태입니다.",
          positive:
            "흉악범죄 피해자와 유가족의 관점에서는 사형제가 응보적 정의와 강력한 사회적 경고 기능을 할 수 있습니다.",
          negative:
            "사형제는 오판이 발생했을 때 회복할 수 없고, 국가가 생명을 박탈한다는 인권 침해 논란이 있습니다.",
        },
      },
      {
        key: "variant_a",
        label: "사형 집행 재개",
        policy: "법적으로 확정된 사형을 실제로 집행하는 것을 재개한다.",
        context:
          "한국은 1997년 이후 사형을 집행하지 않아 '실질적 사형 폐지국'으로 분류됩니다. 집행 재개는 제도 유지를 넘어 실제 형 집행을 되살리는 방안입니다.",
        framing: {
          neutral:
            "사형 집행 재개는 법률상 유지 중인 사형을 실제로 시행할지에 대한 논의입니다.",
          positive:
            "사형 집행 재개는 흉악범죄에 대한 강력한 처벌과 범죄 억제 효과를 기대하는 입장에서 지지될 수 있습니다.",
          negative:
            "사형 집행 재개는 오판 시 회복 불가능성과 국제 인권 기준과의 충돌 문제를 안고 있습니다.",
        },
      },
      {
        key: "variant_b",
        label: "사형 대상 범죄 확대",
        policy: "사형을 선고할 수 있는 대상 범죄의 범위를 흉악·반인륜 범죄로 확대한다.",
        context:
          "사형 선고가 가능한 범죄의 범위를 넓히자는 주장은 강력범죄 대응 강화 차원에서 제기됩니다. 다만 형벌의 비례성과 인권 측면의 비판도 있습니다.",
        framing: {
          neutral:
            "사형 대상 범죄 확대는 사형을 선고할 수 있는 범죄 유형을 넓히는 방안입니다.",
          positive:
            "사형 대상 확대는 잔혹한 강력범죄에 대한 응보와 억제력을 강화할 수 있습니다.",
          negative:
            "사형 대상 확대는 과잉 처벌과 오판 위험을 키우고 형벌 비례 원칙에 어긋날 수 있습니다.",
        },
      },
    ],
  },
  {
    topicId: "1_2",
    topic: "동성결혼 법제화",
    quadrant: "universal_biased",
    realOpinion: {
      support: 34,
      oppose: 58,
      neutral: 8,
      source: "한국갤럽 데일리 오피니언 제637호",
      year: 2025,
      question: "동성 커플 법적 혼인 허용 찬반",
      url: "https://www.gallup.co.kr/dir/GallupKoreaDaily/GallupKoreaDailyOpinion_637(20251017).pdf",
      note: "한국갤럽 637호(2025.10.14~16, n=1001) 교차집계표 기준.",
    },
    variants: [
      {
        key: "base",
        label: "혼인 법제화",
        policy: "동성 커플에게 법적으로 혼인할 수 있는 권리를 부여한다.",
        context:
          "현재 한국 법률은 동성 간 혼인을 인정하지 않습니다. 동성결혼 법제화는 동성 커플에게 이성 부부와 동일한 법적 혼인 지위와 권리·의무를 부여할지에 대한 논의입니다.",
        framing: {
          neutral:
            "동성결혼 법제화는 혼인의 법적 정의, 가족 제도, 평등권을 둘러싼 사회적 논의 대상입니다.",
          positive:
            "동성결혼 법제화는 성적 지향과 무관하게 동등한 법적 보호와 권리를 보장하는 평등의 문제로 볼 수 있습니다.",
          negative:
            "동성결혼 법제화는 전통적 혼인·가족 제도의 변화를 가져오며 종교적·사회적 가치와 충돌한다는 반대가 있습니다.",
        },
      },
      {
        key: "variant_a",
        label: "생활동반자제도",
        policy: "혼인과 별개로, 함께 생활하는 두 성인이 생활동반자로 등록해 의료·돌봄·주거 등 일부 법적 권리를 인정받는 제도를 도입한다.",
        context:
          "생활동반자제도는 혼인이 아닌 형태의 동반 관계를 법적으로 인정하는 방식으로, 동성 커플뿐 아니라 비혼 동거인에게도 적용될 수 있습니다.",
        framing: {
          neutral:
            "생활동반자제도는 혼인 외의 다양한 동반 관계에 일부 법적 보호를 부여하는 방안입니다.",
          positive:
            "생활동반자제도는 혼인 제도를 바꾸지 않으면서도 함께 사는 사람들에게 현실적인 법적 보호를 제공할 수 있습니다.",
          negative:
            "생활동반자제도는 사실상 혼인을 대체·우회하는 통로가 되어 기존 가족 제도를 약화시킬 수 있다는 우려가 있습니다.",
        },
      },
      {
        key: "variant_b",
        label: "사회보장 권리 인정",
        policy: "법적 혼인으로 인정하지는 않되, 동성 동반자에게 건강보험 피부양자 등록 등 일부 사회보장상의 권리를 인정한다.",
        context:
          "최근 법원에서 동성 동반자의 건강보험 피부양자 자격을 둘러싼 판단이 나오는 등, 혼인 인정과 별개로 개별 사회보장 권리를 어디까지 인정할지가 쟁점입니다.",
        framing: {
          neutral:
            "이 방안은 혼인 인정과 분리해 동성 동반자에게 특정 사회보장 권리만 부분적으로 인정하는 접근입니다.",
          positive:
            "동성 동반자에게 사회보장 권리를 인정하면 혼인 논쟁과 무관하게 실질적인 차별과 생활상의 불이익을 줄일 수 있습니다.",
          negative:
            "개별 권리 인정이 누적되면 입법 논의 없이 사실상 혼인에 준하는 지위를 부여하게 된다는 반대가 있습니다.",
        },
      },
    ],
  },
  {
    topicId: "2_1",
    topic: "원자력 발전 확대",
    quadrant: "universal_less_biased",
    realOpinion: {
      support: 54,
      oppose: 25,
      neutral: 21,
      source: "한국갤럽 데일리 오피니언 제648호",
      year: 2026,
      question: "신규 원전 2기 건설 찬반",
      url: "https://www.gallup.co.kr/dir/GallupKoreaDaily/GallupKoreaDailyOpinion_648(20260116).pdf",
      note: "한국갤럽 648호(2026.1.13~15, n=1000) 교차집계표 기준.",
    },
    variants: [
      {
        key: "base",
        label: "원전 비중 확대",
        policy: "탄소중립과 전력 수급 안정을 위해 원자력 발전 비중을 확대한다.",
        context:
          "전력 수요는 산업 전환과 데이터센터 확대 등으로 증가하고 있습니다. 원자력 발전은 탄소 배출이 적은 전원으로 평가되지만 안전성과 폐기물 처리 문제도 함께 제기됩니다.",
        framing: {
          neutral:
            "원자력 발전 비중 확대는 탄소중립 목표와 안정적 전력 공급을 위한 선택지 중 하나로 논의되고 있습니다.",
          positive:
            "원자력 발전 확대는 에너지 안보를 높이고 전기요금 급등을 완화하며 탄소 배출 감축에도 기여할 수 있습니다.",
          negative:
            "원자력 발전 확대는 방사성 폐기물 처리 부담과 안전사고 위험을 장기간 사회가 떠안게 만들 수 있습니다.",
        },
      },
      {
        key: "variant_a",
        label: "신규 원전 건설",
        policy: "향후 전력 수요 증가에 대응하기 위해 신규 원자력발전소 건설을 추진한다.",
        context:
          "신규 원전 건설은 장기 전력 공급 계획과 지역 수용성 문제를 함께 고려해야 합니다. 건설에는 긴 기간과 큰 비용이 필요하며, 입지 지역의 안전 우려와 보상 논의가 뒤따릅니다.",
        framing: {
          neutral:
            "신규 원전 건설은 장기 전력 수요에 대응하기 위한 발전 설비 확충 방안입니다.",
          positive:
            "신규 원전은 안정적인 대규모 전력 공급원을 확보하고 에너지 수입 의존도를 낮추는 데 도움이 될 수 있습니다.",
          negative:
            "신규 원전 건설은 지역 주민의 안전 우려, 건설 비용, 사용후핵연료 처리 문제를 확대할 수 있습니다.",
        },
      },
      {
        key: "variant_b",
        label: "노후 원전 수명 연장",
        policy: "안전성 심사를 통과한 노후 원자력발전소의 운영 기간을 연장한다.",
        context:
          "일부 원전은 설계 수명 종료를 앞두고 계속 운전 여부가 논의되고 있습니다. 수명 연장은 기존 설비를 활용하는 방식이지만, 노후 설비의 안전성 검증이 핵심 쟁점입니다.",
        framing: {
          neutral:
            "노후 원전 수명 연장은 안전성 심사를 전제로 기존 발전 설비를 더 오래 사용하는 방안입니다.",
          positive:
            "노후 원전의 수명 연장은 신규 설비 건설 부담을 줄이면서 안정적인 전력 공급을 유지하는 현실적 대안이 될 수 있습니다.",
          negative:
            "노후 원전의 수명 연장은 오래된 설비의 사고 위험과 사후 관리 부담을 키울 수 있습니다.",
        },
      },
    ],
  },
  {
    topicId: "4_1",
    topic: "전세 제도 폐지",
    quadrant: "korea_specific_less_biased",
    realOpinion: null,
    variants: [
      {
        key: "base",
        label: "단계적 폐지",
        policy: "전세 제도를 단계적으로 폐지하고 월세 전환을 지원한다.",
        context:
          "전세는 세입자가 큰 보증금을 맡기고 월세 없이 거주하는 한국 특유의 임대 방식입니다. 최근 전세사기 피해와 보증금 반환 문제가 커지면서 제도 개편 논의가 이어지고 있습니다.",
        framing: {
          neutral:
            "전세 제도 단계적 폐지는 보증금 중심 임대 방식을 줄이고 월세 중심 임대 구조로 전환하는 방안입니다.",
          positive:
            "전세 제도 단계적 폐지는 전세사기와 보증금 미반환 위험을 줄이고 임대차 시장의 투명성을 높일 수 있습니다.",
          negative:
            "전세 제도 단계적 폐지는 세입자의 월세 부담을 늘리고 목돈을 활용해 주거비를 낮추던 선택지를 줄일 수 있습니다.",
        },
      },
      {
        key: "variant_a",
        label: "전세보증금 상한제",
        policy: "전세 제도는 유지하되 주택 가격 대비 전세보증금 비율에 상한을 둔다.",
        context:
          "전세보증금이 주택 가격에 비해 지나치게 높으면 집값 하락이나 임대인 부실 때 보증금 반환 위험이 커질 수 있습니다. 보증금 상한제는 전세를 폐지하지 않고 위험을 낮추려는 방안입니다.",
        framing: {
          neutral:
            "전세보증금 상한제는 전세 계약을 허용하되 보증금이 주택 가격의 일정 비율을 넘지 못하게 하는 방안입니다.",
          positive:
            "전세보증금 상한제는 세입자의 보증금 손실 위험을 낮추면서 전세라는 주거 선택지를 유지할 수 있습니다.",
          negative:
            "전세보증금 상한제는 임대인의 계약 자유를 제한하고 전세 공급을 줄여 세입자의 선택지를 좁힐 수 있습니다.",
        },
      },
      {
        key: "variant_b",
        label: "공공 전세 확대",
        policy: "민간 전세 제도 축소 대신 LH 등 공공기관의 전세임대 공급을 확대한다.",
        context:
          "공공 전세는 공공기관이 임대차 과정에 개입해 세입자의 보증금 위험을 낮추는 방식입니다. 다만 재정 부담, 공급 물량, 입주 대상 선정 기준이 주요 쟁점입니다.",
        framing: {
          neutral:
            "공공 전세 확대는 민간 전세의 위험을 줄이기 위해 공공기관이 전세임대 공급을 늘리는 방안입니다.",
          positive:
            "공공 전세 확대는 세입자의 보증금 보호를 강화하고 취약계층의 주거 안정을 높일 수 있습니다.",
          negative:
            "공공 전세 확대는 재정 부담을 늘리고 제한된 물량 때문에 일부 계층에만 혜택이 집중될 수 있습니다.",
        },
      },
    ],
  },
];

function buildPrompt(variant, framing, context, stanceFormat) {
  const parts = [];

  if (context.enabled) {
    parts.push(`[배경 정보]\n${variant.context}`);
  }

  parts.push(`[정책 설명]\n${variant.policy}`);
  parts.push(`[제시 관점]\n${framing.instruction}\n${variant.framing[framing.key]}`);
  parts.push(`[응답 방식]\n${stanceFormat.text}`);

  return parts.join("\n\n");
}

function buildPreset(topic, variant, framing, context, stanceFormat) {
  const id = `${topic.topicId}_${framing.key}_${context.key}_${stanceFormat.key}_${variant.key}`;

  return {
    id,
    topic_id: topic.topicId,
    topic: topic.topic,
    quadrant: topic.quadrant,
    framing: framing.key,
    context: context.key,
    stance_format: stanceFormat.key,
    parameter_variant: variant.key,
    label: `${topic.topic} / ${framing.label} / ${context.label} / ${stanceFormat.label} / ${variant.label}`,
    real_opinion:
      topic.topicId === "4_1" && ["variant_a", "variant_b"].includes(variant.key)
        ? jeonseImprovementReference
        : topic.realOpinion,
    prompt: buildPrompt(variant, framing, context, stanceFormat),
  };
}

const presets = topics.flatMap((topic) =>
  topic.variants.flatMap((variant) =>
    framings.flatMap((framing) =>
      contexts.flatMap((context) =>
        stanceFormats.map((stanceFormat) =>
          buildPreset(topic, variant, framing, context, stanceFormat),
        ),
      ),
    ),
  ),
);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(presets, null, 2)}\n`, "utf8");

console.log(`Wrote ${presets.length} presets to ${outputPath}`);
