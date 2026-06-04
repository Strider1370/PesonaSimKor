export const AXIS_LABELS: Record<string, string> = {
  age_band: "나이",
  gender: "성별",
  region_group: "지역",
  occupation_stratum: "직업",
  household_stratum: "가구",
  housing_stratum: "주거",
  education_stratum: "학력",
  field_stratum: "전공",
}

const CATEGORY_LABELS: Record<string, string> = {
  "1": "관리자",
  "2": "전문가",
  "3": "사무",
  "4": "서비스",
  "5": "판매",
  "6": "농림어업",
  "7": "기능원",
  "8": "장치·기계조작",
  "9": "단순노무",
  A: "군인",
  unemployed: "무직",
  unemployed_노년은퇴: "노년·은퇴",
  unemployed_청년취준: "청년·취준",
  unemployed_전업돌봄: "전업·돌봄",
  unemployed_구직중: "구직 중",
  unemployed_기타: "무직 기타",
  etc: "기타",

  male: "남성",
  female: "여성",
  unknown: "미상",

  capital: "수도권",
  yeongnam: "영남",
  honam: "호남",
  chungcheong: "충청",
  gangwon: "강원",
  jeju: "제주",
  other: "기타 지역",

  "20s": "20대",
  "30s": "30대",
  "40s": "40대",
  "50s": "50대",
  "60s": "60대",
  "70_plus": "70대 이상",

  single: "1인 가구",
  couple: "부부",
  couple_children: "부부+자녀",
  shared: "동거 가구",
  single_parent: "한부모 가구",
  parents: "부모 동거",
  parent_household: "부모 동거",
  multi_generation: "3세대 이상",
  기타: "기타",
  "1인": "1인 가구",
  "부부": "부부",
  "부부+자녀": "부부+자녀",
  "3인+": "3인 이상",
  "3세대+": "3세대 이상",
  부모동거: "부모 동거",

  rent: "월세",
  jeonse: "전세",
  owner: "자가",
  apartment: "아파트",
  detached: "단독주택",
  multiplex: "연립·다세대",
  non_residential: "비주거 거처",
  "아파트": "아파트",
  "단독주택": "단독주택",
  "연립주택": "연립주택",
  "다세대주택": "다세대주택",
  "주택 이외의 거처": "주택 외 거처",

  high: "고등학교",
  college: "대학",
  graduate: "대학원",
  none: "무학",
  elementary: "초등학교",
  middle: "중학교",
  "고등학교": "고등학교",
  "4년제 대학교": "4년제 대학",
  "2~3년제 전문대": "전문대",
  "대학원": "대학원",
  "무학": "무학",

  admin: "경영·행정·법",
  health: "보건·복지",
  education: "교육",
  engineering: "공학·제조·건설",
  arts: "예술·인문",
  ict: "정보통신",
  services: "서비스",
  science: "자연과학·수학",
  agriculture: "농림어업·수의학",
  "해당없음": "전공 없음",
  "경영·행정·법": "경영·행정·법",
  "공학·제조·건설": "공학·제조·건설",
  "보건·복지": "보건·복지",
  "정보통신기술": "정보통신",
}

export function axisLabel(axis: string): string {
  return AXIS_LABELS[axis] ?? readableFallback(axis)
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? readableFallback(category)
}

export function tagLabel(value: string): string {
  for (const axis of Object.keys(AXIS_LABELS)) {
    if (value.startsWith(`${axis} `)) {
      return `${axisLabel(axis)} ${categoryLabel(value.slice(axis.length + 1))}`
    }
  }
  return CATEGORY_LABELS[value] ?? readableFallback(value)
}

export function stanceLabel(stance: string): string {
  if (stance === "support") return "찬성"
  if (stance === "oppose") return "반대"
  if (stance === "neutral") return "중립"
  return readableFallback(stance)
}

export function groundingLabel(value: "direct" | "inferred" | null): string {
  if (value === "direct") return "직접"
  if (value === "inferred") return "추정"
  return "근거 없음"
}

function readableFallback(value: string): string {
  return value.replace(/^unemployed_/, "").replaceAll("_", " ")
}
