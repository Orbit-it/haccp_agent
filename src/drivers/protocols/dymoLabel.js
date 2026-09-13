// Génération d'étiquettes DYMO (format DLS/XML), envoyées telles quelles sur
// le port 9100 (réseau) ou via USB. Repris du format déjà validé côté
// backend (services/DymoPrinterService.js) pour garantir un rendu identique.

const LABEL_NAMES = {
  '30252': 'Large Label (62x100mm)',
  '30256': 'Medium Label (38x89mm)',
  '30258': 'Address Label (51x89mm)',
  '30272': 'Shipping Label (12x89mm)'
};

function getLabelName(type) {
  return LABEL_NAMES[type] || 'Large Label (62x100mm)';
}

// payload attendu : { product_name, date, dlc_date, preparer_name, batch_number, custom_text, label_type }
function buildLabel(payload = {}) {
  const {
    product_name, date, dlc_date, preparer_name, batch_number, custom_text,
    label_type = '30252'
  } = payload;

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Portrait</PaperOrientation>
  <Id>${label_type}</Id>
  <PaperName>${getLabelName(label_type)}</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="1585" Height="2440" Rx="270" Ry="270"/>
  </DrawCommands>

  <ObjectInfo>
    <TextObject>
      <Name>PRODUCT_NAME</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <TextFitMode>AlwaysFit</TextFitMode>
      <StyledText>
        <Element>
          <String>${product_name || 'PRODUIT'}</String>
          <Attributes><Font Family="Arial" Size="16" Bold="True"/></Attributes>
        </Element>
      </StyledText>
    </TextObject>
    <Bounds X="331" Y="150" Width="4455" Height="600"/>
  </ObjectInfo>

  <ObjectInfo>
    <TextObject>
      <Name>PREPARATION_DATE</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <HorizontalAlignment>Left</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <StyledText>
        <Element>
          <String>Préparé: ${date || ''}</String>
          <Attributes><Font Family="Arial" Size="10"/></Attributes>
        </Element>
      </StyledText>
    </TextObject>
    <Bounds X="331" Y="800" Width="2000" Height="300"/>
  </ObjectInfo>

  <ObjectInfo>
    <TextObject>
      <Name>DLC_DATE</Name>
      <ForeColor Alpha="255" Red="255" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <HorizontalAlignment>Right</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <StyledText>
        <Element>
          <String>DLC: ${dlc_date || ''}</String>
          <Attributes><Font Family="Arial" Size="10" Bold="True"/></Attributes>
        </Element>
      </StyledText>
    </TextObject>
    <Bounds X="2586" Y="800" Width="2200" Height="300"/>
  </ObjectInfo>

  <ObjectInfo>
    <TextObject>
      <Name>BATCH_NUMBER</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <StyledText>
        <Element>
          <String>Lot: ${batch_number || ''}</String>
          <Attributes><Font Family="Arial" Size="11" Bold="True"/></Attributes>
        </Element>
      </StyledText>
    </TextObject>
    <Bounds X="331" Y="1200" Width="4455" Height="300"/>
  </ObjectInfo>

  <ObjectInfo>
    <TextObject>
      <Name>PREPARER</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="128"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <StyledText>
        <Element>
          <String>${preparer_name || ''}</String>
          <Attributes><Font Family="Arial" Size="10"/></Attributes>
        </Element>
      </StyledText>
    </TextObject>
    <Bounds X="331" Y="1600" Width="4455" Height="300"/>
  </ObjectInfo>

  ${custom_text ? `
  <ObjectInfo>
    <TextObject>
      <Name>CUSTOM_TEXT</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0"/>
      <BackColor Alpha="0" Red="255" Green="255" Blue="255"/>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <StyledText>
        <Element>
          <String>${custom_text}</String>
          <Attributes><Font Family="Arial" Size="8" Italic="True"/></Attributes>
        </Element>
      </StyledText>
    </TextObject>
    <Bounds X="331" Y="2000" Width="4455" Height="300"/>
  </ObjectInfo>` : ''}
</DieCutLabel>`;

  return Buffer.from(xml, 'utf8');
}

module.exports = { buildLabel, getLabelName };
