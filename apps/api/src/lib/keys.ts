import forge from 'node-forge';

export interface KeyInfo {
  subject: string;
  holder: string;
  tin: string | null;
  notBefore: string;
  notAfter: string;
  serial: string;
}

export function parsePfx(bytes: Buffer, password: string): KeyInfo {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(bytes.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch {
    throw new Error('KEY_UNREADABLE');
  }

  const bags = p12.getBags({ bagType: forge.pki.oids.certBag }) as Record<string, Array<{ cert?: forge.pki.Certificate }>>;
  const certBag = bags[String(forge.pki.oids.certBag)]?.[0];
  const cert = certBag?.cert;
  if (!cert) throw new Error('KEY_NO_CERT');

  interface CertAttr {
    shortName?: string;
    type?: string;
    value?: unknown;
  }
  const attributes = (cert.subject.attributes ?? []) as CertAttr[];
  const values = attributes.map((attr) => String(attr.value ?? '')).filter(Boolean);
  const cn = attributes.find((attr) => attr.shortName === 'CN')?.value;
  const org = attributes.find((attr) => attr.shortName === 'O')?.value;

  let tin: string | null = null;
  const innAttr = attributes.find((attr) => attr.type === '1.2.860.3.16.1.1');
  if (innAttr && /^\d{9}$/.test(String(innAttr.value))) tin = String(innAttr.value);
  if (!tin) {
    for (const value of values) {
      const match = value.match(/(?:^|\D)(\d{9})(?:\D|$)/);
      if (match?.[1]) {
        tin = match[1];
        break;
      }
    }
  }

  return {
    subject: String(cn ?? org ?? 'Noma’lum subyekt'),
    holder: String(org ?? cn ?? ''),
    tin,
    notBefore: new Date(cert.validity.notBefore).toISOString(),
    notAfter: new Date(cert.validity.notAfter).toISOString(),
    serial: String(cert.serialNumber ?? ''),
  };
}
