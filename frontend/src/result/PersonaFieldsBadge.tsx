import type { PersonaDepth } from "../lib/api"

const FIELD_LABELS: Record<string, string> = {
  age: "나이",
  gender: "성별",
  province: "시도",
  district: "시군구",
  occupation: "직업",
  family_type: "가구형태",
  marital_status: "혼인",
  housing_type: "주거",
  education_level: "학력",
  bachelors_field: "전공",
  professional_persona: "직업서사",
  family_persona: "가족서사",
  persona: "종합서사",
  career_goals_and_ambitions: "진로",
  cultural_background: "문화배경",
  skills_and_expertise: "기술전문성",
  arts_persona: "예술 취향",
  travel_persona: "여행 취향",
  culinary_persona: "미식 취향",
  sports_persona: "스포츠 취향",
  hobbies_and_interests: "취미",
}

export function PersonaFieldsBadge({
  depth,
  includedFields,
  selectedOptional,
}: {
  depth?: PersonaDepth
  includedFields: string[]
  selectedOptional: string[]
}) {
  if (!depth && includedFields.length === 0) {
    return <p className="persona-fields-badge empty">항목 정보 없음</p>
  }

  const optional = new Set(selectedOptional)
  const always = includedFields.filter((field) => !optional.has(field))
  const label = (field: string) => FIELD_LABELS[field] ?? field

  return (
    <div className="persona-fields-badge">
      <span className="depth">{depth ?? "standard"}</span>
      <span className="always">항상: {always.map(label).join(" · ") || "없음"}</span>
      {selectedOptional.length > 0 && <span className="selected">정책 선택: {selectedOptional.map(label).join(", ")}</span>}
    </div>
  )
}
