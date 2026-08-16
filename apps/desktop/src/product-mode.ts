export type ProductMode = "directdrop" | "lan-share";

export type ProductModeDefinition = {
  id: ProductMode;
  label: string;
  description: string;
  requiresInternet: boolean;
};

export const productModes: Record<ProductMode, ProductModeDefinition> = {
  directdrop: {
    id: "directdrop",
    label: "DirectDrop",
    description: "인터넷 공유 링크",
    requiresInternet: true,
  },
  "lan-share": {
    id: "lan-share",
    label: "LAN Share",
    description: "같은 네트워크 전송",
    requiresInternet: false,
  },
};
