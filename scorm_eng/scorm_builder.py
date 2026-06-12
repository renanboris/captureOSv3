import logging
import os
import zipfile
import json
from pathlib import Path
from contracts.simlink_models import SimlinkModulo

logger = logging.getLogger(__name__)

class ScormBuilder:
    def __init__(self, simlink_modulo: SimlinkModulo, session_id: str, titulo: str):
        self.simlink_modulo = simlink_modulo
        self.session_id = session_id
        self.titulo = titulo
        self.output_base = Path("data/scorm")
        
    def _gerar_manifest(self) -> str:
        """Gera o imsmanifest.xml para SCORM 1.2"""
        return f"""<?xml version="1.0" encoding="utf-8"?>
<manifest identifier="CaptureOS_TRY_{self.session_id}" version="1.0"
          xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                              http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd
                              http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
    <metadata>
        <schema>ADL SCORM</schema>
        <schemaversion>1.2</schemaversion>
    </metadata>
    <organizations default="default_org">
        <organization identifier="default_org">
            <title>&#8203;</title>
            <item identifier="item_1" identifierref="resource_1">
                <title>&#8203;</title>
            </item>
        </organization>
    </organizations>
    <resources>
        <resource identifier="resource_1" type="webcontent" adlcp:scormtype="sco" href="index.html">
            <file href="index.html"/>
            <file href="css/style.css"/>
            <file href="js/scorm-api.js"/>
            <file href="js/try-player.js"/>
            <file href="data/steps.js"/>
        </resource>
    </resources>
</manifest>
"""

    def _exportar_steps_json(self) -> dict:
        # Converter SimlinkModulo para dicionário JSON
        steps_dict = self.simlink_modulo.model_dump()
        for hotspot in steps_dict.get('hotspots', []):
            if hotspot.get('screenshot_path'):
                filename = os.path.basename(hotspot['screenshot_path'])
                hotspot['screenshot_filename'] = filename
            if hotspot.get('audio_path'):
                filename = os.path.basename(hotspot['audio_path'])
                hotspot['audio_filename'] = filename
        return steps_dict

    def build(self) -> str:
        self.output_base.mkdir(parents=True, exist_ok=True)
        zip_path = self.output_base / f"{self.session_id}.zip"
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # 1. Manifest
            manifest_content = self._gerar_manifest()
            zipf.writestr('imsmanifest.xml', manifest_content)
            
            # 2. steps.js
            steps_data = self._exportar_steps_json()
            js_content = f"const STEPS_DATA = {json.dumps(steps_data, ensure_ascii=False, indent=2)};"
            zipf.writestr('data/steps.js', js_content)
            
            # 3. Screenshots e Áudios
            screenshots_dir = Path(f"data/simlink_screenshots/{self.session_id}")
            if screenshots_dir.exists():
                for img_path in screenshots_dir.glob('*.png'):
                    zipf.write(img_path, f"screenshots/{img_path.name}")
            else:
                logger.warning(f"Screenshots dir not found: {screenshots_dir}")
                
            for hotspot in self.simlink_modulo.hotspots:
                if hotspot.audio_path and os.path.exists(hotspot.audio_path):
                    filename = os.path.basename(hotspot.audio_path)
                    zipf.write(hotspot.audio_path, f"audios/{filename}")
                
            # 4. Templates (index.html, css/style.css, js/scorm-api.js, js/try-player.js)
            templates_dir = Path("scorm_eng/templates")
            for root, _, files in os.walk(templates_dir):
                for file in files:
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(templates_dir)
                    zipf.write(file_path, arcname)
                    
        return str(zip_path)

def gerar_scorm(simlink_modulo: SimlinkModulo, session_id: str, titulo: str) -> str:
    """
    Empacota o modo Try num formato ZIP SCORM 1.2 navegável para plataformas LMS (ex: Senior X Learning).
    """
    logger.info(f"Gerando pacote SCORM para sessão {session_id}...")
    builder = ScormBuilder(simlink_modulo, session_id, titulo)
    return builder.build()
