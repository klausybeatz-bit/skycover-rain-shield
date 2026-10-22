export interface LocationPreset {
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  persona: "farmer" | "homestay" | "tour guide";
}

/** Sample coverage locations across India's monsoon-exposed regions. */
export const LOCATION_PRESETS: LocationPreset[] = [
  { name: "Cherrapunji, Meghalaya", region: "Northeast", latitude: 25.28, longitude: 91.7, persona: "farmer" },
  { name: "Guwahati, Assam", region: "Northeast", latitude: 26.14, longitude: 91.73, persona: "farmer" },
  { name: "Kolkata, West Bengal", region: "East", latitude: 22.57, longitude: 88.36, persona: "homestay" },
  { name: "Munnar, Kerala", region: "South", latitude: 10.09, longitude: 77.06, persona: "homestay" },
  { name: "Darjeeling, West Bengal", region: "East", latitude: 27.04, longitude: 88.26, persona: "tour guide" },
  { name: "Shillong, Meghalaya", region: "Northeast", latitude: 25.57, longitude: 91.88, persona: "tour guide" },
  { name: "Mumbai, Maharashtra", region: "West", latitude: 19.08, longitude: 72.88, persona: "homestay" },
];

export const PERSONA_LABEL: Record<LocationPreset["persona"], string> = {
  farmer: "Farmer",
  homestay: "Homestay owner",
  "tour guide": "Tour guide",
};
