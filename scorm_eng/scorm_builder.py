import asyncio
import logging
import os
import zipfile
import json
from pathlib import Path
from contracts.simlink_models import SimlinkModulo

logger = logging.getLogger(__name__)

class ScormBuilder:
    def __init__(
        self,
        simlink_modulo: SimlinkModulo,
        session_id: str,
        titulo: str,
        incluir_quiz: bool = False,
        num_questoes_quiz: int = 3,
        quiz_data_path: str | None = None,
    ):
        self.simlink_modulo = simlink_modulo
        self.session_id = session_id
        self.titulo = titulo
        self.incluir_quiz = incluir_quiz
        self.num_questoes_quiz = self._validate_num_questoes(num_questoes_quiz)
        self.quiz_data_path = quiz_data_path  # pre-generated quiz JSON, bypasses LLM
        self.output_base = Path("data/scorm")

    def _validate_num_questoes(self, num: int) -> int:
        """Validate and clamp num_questoes_quiz to the valid range [1, 10].
        
        Returns the clamped value if within range, or the default of 3 with a
        warning logged when out of range.
        """
        if num < 1 or num > 10:
            logger.warning(
                f"num_questoes_quiz={num} fora do intervalo válido [1, 10], "
                f"usando valor padrão=3"
            )
            return 3
        return num
        
    async def _generate_quiz(self) -> list:
        """Invoke Quiz_Generator to produce quiz questions from the module's hotspots.

        Extracts a roteiro from simlink_modulo.hotspots, then calls gerar_quiz
        with a 60-second asyncio timeout.  Returns an empty list on any failure
        and logs an appropriate warning or error.

        Requirements: 4.1, 4.7, 6.1
        """
        from artifacts.quiz_generator import gerar_quiz

        # Build roteiro: one entry per hotspot using the fields expected by gerar_quiz
        roteiro = [
            {
                "passo": h.passo_num,
                "ancora": h.ancora,
                "micro_narracao": h.micro_narracao,
            }
            for h in self.simlink_modulo.hotspots
        ]

        try:
            logger.info(
                f"[{self.session_id}] Gerando quiz com {self.num_questoes_quiz} questões..."
            )
            quiz_data = await asyncio.wait_for(
                gerar_quiz(roteiro, num_questoes=self.num_questoes_quiz),
                timeout=60.0,
            )

            if not quiz_data:
                logger.warning(
                    f"[{self.session_id}] Quiz_Generator retornou lista vazia; "
                    f"pacote SCORM será gerado sem quiz."
                )
                return []

            logger.info(
                f"[{self.session_id}] Quiz gerado com sucesso: {len(quiz_data)} questões."
            )
            return quiz_data

        except asyncio.TimeoutError:
            logger.warning(
                f"[{self.session_id}] Timeout ao gerar quiz (>60s); "
                f"pacote SCORM será gerado sem quiz."
            )
            return []
        except Exception as e:
            logger.warning(
                f"[{self.session_id}] Falha ao gerar quiz: {e}; "
                f"pacote SCORM será gerado sem quiz."
            )
            return []

    def _write_quiz(self, zipf: zipfile.ZipFile, quiz_data: list) -> None:
        """Serialize quiz data to JavaScript and write it to data/quiz.js in the ZIP.

        The file is written in the format expected by Try_Player:
            const QUIZ_DATA = [...];

        Requirements: 4.2, 6.3
        """
        js_content = (
            "const QUIZ_DATA = "
            + json.dumps(quiz_data, ensure_ascii=False, indent=2)
            + ";"
        )
        zipf.writestr("data/quiz.js", js_content)
        logger.info(
            f"[{self.session_id}] quiz.js escrito no pacote com {len(quiz_data)} questões."
        )

    def _gerar_manifest(self, include_quiz: bool = False) -> str:
        """Gera o imsmanifest.xml para SCORM 1.2.

        When include_quiz=True, adds a <file href="data/quiz.js"/> entry to the
        resource so the LMS is aware of the file and it is included in the
        package resource listing (Requirements: 4.2, 4.3).
        """
        quiz_file_entry = '            <file href="data/quiz.js"/>\n' if include_quiz else ""
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
            <title>{self.titulo}</title>
            <item identifier="item_1" identifierref="resource_1">
                <title>Modo Prática Guiada</title>
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
{quiz_file_entry}        </resource>
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

    async def build(self) -> str:
        """Generate a SCORM 1.2 package, optionally including a quiz.

        When self.incluir_quiz is True, _generate_quiz() is awaited first.
        If questions are returned, quiz.js is written to the package and the
        manifest is updated to reference it.  Failures in quiz generation are
        non-fatal: the package is always produced.

        Requirements: 4.1, 4.2, 4.3, 4.7
        """
        self.output_base.mkdir(parents=True, exist_ok=True)
        zip_path = self.output_base / f"{self.session_id}.zip"

        # --- Optional quiz generation (must happen before building the ZIP so
        #     we know whether to include quiz.js in the manifest) ---
        quiz_data: list = []
        if self.incluir_quiz:
            if self.quiz_data_path and os.path.exists(self.quiz_data_path):
                # Reuse pre-generated quiz (avoids an LLM call)
                try:
                    with open(self.quiz_data_path, "r", encoding="utf-8") as f:
                        quiz_data = json.load(f)
                    logger.info(
                        f"[{self.session_id}] Quiz carregado de {self.quiz_data_path} "
                        f"({len(quiz_data)} questões)."
                    )
                except Exception as e:
                    logger.warning(f"[{self.session_id}] Falha ao ler quiz_data_path: {e}")
            else:
                # Fall back to LLM generation
                quiz_data = await self._generate_quiz()

        include_quiz_in_package = bool(quiz_data)

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # 1. Manifest — include quiz.js reference only when we have questions
            manifest_content = self._gerar_manifest(include_quiz=include_quiz_in_package)
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

            # Pack intro audio if available (step 0 welcome narration)
            intro_filename = getattr(self.simlink_modulo, 'intro_audio_filename', None)
            if intro_filename:
                intro_audio_path = f"data/audios/{self.session_id}/{intro_filename}"
                if os.path.exists(intro_audio_path):
                    zipf.write(intro_audio_path, f"audios/{intro_filename}")
                    logger.info(f"[{self.session_id}] Intro audio empacotado: {intro_filename}")

            # 4. Templates (index.html, css/style.css, js/scorm-api.js, js/try-player.js)
            templates_dir = Path("scorm_eng/templates")
            for root, _, files in os.walk(templates_dir):
                for file in files:
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(templates_dir)
                    zipf.write(file_path, arcname)

            # 5. Quiz (data/quiz.js) — only when questions were generated
            if include_quiz_in_package:
                self._write_quiz(zipf, quiz_data)

        logger.info(f"[{self.session_id}] Pacote SCORM gerado: {zip_path}")
        return str(zip_path)

async def gerar_scorm(
    simlink_modulo: SimlinkModulo,
    session_id: str,
    titulo: str,
    incluir_quiz: bool = False,
    num_questoes_quiz: int = 3,
    quiz_data_path: str | None = None,
) -> str:
    """Empacota o modo Try num formato ZIP SCORM 1.2 navegável para plataformas LMS.

    Parâmetros opcionais:
        incluir_quiz       -- quando True, inclui quiz no pacote
        num_questoes_quiz  -- número de questões a gerar via IA (usado apenas se
                             quiz_data_path não for fornecido)
        quiz_data_path     -- caminho para um quiz.json já gerado; quando fornecido,
                             o Quiz_Generator NÃO é invocado (reusa o quiz existente)

    Requirements: 4.1, 7.1
    """
    logger.info(f"Gerando pacote SCORM para sessão {session_id}...")
    builder = ScormBuilder(
        simlink_modulo,
        session_id,
        titulo,
        incluir_quiz=incluir_quiz,
        num_questoes_quiz=num_questoes_quiz,
        quiz_data_path=quiz_data_path,
    )
    return await builder.build()
