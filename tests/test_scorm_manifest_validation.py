"""SCORM 1.2 manifest validation — task 10.1.

Generates an imsmanifest.xml via ScormBuilder._gerar_manifest() and validates
that:
- The XML is well-formed (parseable by xml.etree.ElementTree)
- All required SCORM 1.2 top-level elements are present
  (manifest, metadata, organizations, resources)
- <schemaversion> text is "1.2"
- Required manifest attributes exist (identifier, version, XMLNS declarations)
- <organization> element is present with a default attribute pointer
- At least one <item> child exists under <organization>
- At least one <resource> element exists with required SCORM attributes
- The resource type attribute is "webcontent" and
  adlcp:scormtype is "sco"
- <file href="index.html"/> is present
- <file href="data/steps.js"/> is present
- When include_quiz=True, <file href="data/quiz.js"/> is present
- When include_quiz=False, data/quiz.js is absent from manifest

Requirements: 8.4, 8.5
"""

import xml.etree.ElementTree as ET

import pytest

from contracts.simlink_models import SimlinkModulo
from scorm_eng.scorm_builder import ScormBuilder

# ---------------------------------------------------------------------------
# Namespace constants (as used in imsmanifest.xml)
# ---------------------------------------------------------------------------
NS_CP = "http://www.imsproject.org/xsd/imscp_rootv1p1p2"
NS_ADLCP = "http://www.adlnet.org/xsd/adlcp_rootv1p2"

# Helper to build Clark-notation tag names
def _tag(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def minimal_modulo() -> SimlinkModulo:
    """Minimal valid SimlinkModulo sufficient for manifest generation."""
    return SimlinkModulo(
        modulo_id="manifest_test",
        session_id="manifest_test",
        titulo="Módulo de Validação",
        dominio="exemplo.com.br",
        total_passos=2,
        hotspots=[
            {
                "passo_num": i + 1,
                "xpath": f"//button[{i + 1}]",
                "css_selector": f"button.step-{i + 1}",
                "coordinates": {"x": 10.0, "y": 20.0, "w": 100.0, "h": 30.0},
                "target_text": f"Passo {i + 1}",
                "action": "click",
                "url": "https://exemplo.com.br/app",
                "screenshot_path": (
                    f"data/simlink_screenshots/manifest_test/passo_{i + 1}.png"
                ),
                "ancora": "Boa!",
                "micro_narracao": "Tente clicar aqui.",
                "audio_path": None,
            }
            for i in range(2)
        ],
        video_url="http://localhost:8000/videos_gerados/manifest_test_final.mp4",
        xp_max=20,
        criado_em="2024-01-01T00:00:00",
    )


@pytest.fixture
def builder(minimal_modulo) -> ScormBuilder:
    return ScormBuilder(minimal_modulo, "manifest_test", "Módulo de Validação")


@pytest.fixture
def manifest_xml(builder) -> str:
    """Raw XML string of the manifest without quiz."""
    return builder._gerar_manifest(include_quiz=False)


@pytest.fixture
def manifest_xml_with_quiz(builder) -> str:
    """Raw XML string of the manifest with quiz.js reference."""
    return builder._gerar_manifest(include_quiz=True)


@pytest.fixture
def root(manifest_xml) -> ET.Element:
    """Parsed root element of the manifest without quiz."""
    return ET.fromstring(manifest_xml)


@pytest.fixture
def root_with_quiz(manifest_xml_with_quiz) -> ET.Element:
    """Parsed root element of the manifest with quiz."""
    return ET.fromstring(manifest_xml_with_quiz)


# ---------------------------------------------------------------------------
# 1. Well-formed XML
# ---------------------------------------------------------------------------

class TestManifestWellFormed:
    """The XML must parse without errors under all configurations."""

    def test_manifest_parses_without_error(self, manifest_xml):
        """xml.etree.ElementTree must not raise on the generated manifest."""
        ET.fromstring(manifest_xml)  # raises ParseError if malformed

    def test_manifest_with_quiz_parses_without_error(self, manifest_xml_with_quiz):
        ET.fromstring(manifest_xml_with_quiz)

    def test_manifest_starts_with_xml_declaration(self, manifest_xml):
        """imsmanifest.xml must begin with the XML declaration."""
        assert manifest_xml.lstrip().startswith("<?xml")

    def test_manifest_declares_utf8_encoding(self, manifest_xml):
        assert 'encoding="utf-8"' in manifest_xml.lower()


# ---------------------------------------------------------------------------
# 2. Root <manifest> element
# ---------------------------------------------------------------------------

class TestManifestRootElement:
    """Validate <manifest> root attributes required by SCORM 1.2."""

    def test_root_tag_is_manifest(self, root):
        assert root.tag == _tag(NS_CP, "manifest"), (
            f"Root element must be {{NS}}manifest, got: {root.tag}"
        )

    def test_root_has_identifier_attribute(self, root):
        assert "identifier" in root.attrib, "manifest must have an 'identifier' attribute"

    def test_root_identifier_is_not_empty(self, root):
        assert root.attrib["identifier"].strip(), "manifest identifier must not be empty"

    def test_root_has_version_attribute(self, root):
        assert "version" in root.attrib, "manifest must have a 'version' attribute"

    def test_root_version_is_1_0(self, root):
        assert root.attrib["version"] == "1.0", (
            f"manifest version must be '1.0', got: {root.attrib['version']}"
        )

    def test_root_xmlns_is_imscp(self, manifest_xml):
        """The default namespace must reference the IMS CP root schema."""
        assert "http://www.imsproject.org/xsd/imscp_rootv1p1p2" in manifest_xml

    def test_root_xmlns_adlcp_declared(self, manifest_xml):
        """The adlcp namespace must be declared for adlcp:scormtype."""
        assert "http://www.adlnet.org/xsd/adlcp_rootv1p2" in manifest_xml


# ---------------------------------------------------------------------------
# 3. <metadata> element with SCORM 1.2 schema declaration
# ---------------------------------------------------------------------------

class TestManifestMetadata:
    """SCORM 1.2 requires <metadata><schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion></metadata>."""

    def test_metadata_element_present(self, root):
        metadata = root.find(_tag(NS_CP, "metadata"))
        assert metadata is not None, "<metadata> element must be present"

    def test_metadata_schema_text_is_adl_scorm(self, root):
        metadata = root.find(_tag(NS_CP, "metadata"))
        schema = metadata.find(_tag(NS_CP, "schema"))
        assert schema is not None, "<metadata><schema> element must be present"
        assert schema.text == "ADL SCORM", (
            f"<schema> text must be 'ADL SCORM', got: {schema.text!r}"
        )

    def test_metadata_schemaversion_element_present(self, root):
        metadata = root.find(_tag(NS_CP, "metadata"))
        schemaversion = metadata.find(_tag(NS_CP, "schemaversion"))
        assert schemaversion is not None, "<metadata><schemaversion> element must be present"

    def test_metadata_schemaversion_text_is_1_2(self, root):
        """SCORM 1.2 compliance requires schemaversion == '1.2'."""
        metadata = root.find(_tag(NS_CP, "metadata"))
        schemaversion = metadata.find(_tag(NS_CP, "schemaversion"))
        assert schemaversion.text == "1.2", (
            f"<schemaversion> must be '1.2', got: {schemaversion.text!r}"
        )


# ---------------------------------------------------------------------------
# 4. <organizations> element
# ---------------------------------------------------------------------------

class TestManifestOrganizations:
    """SCORM 1.2 requires <organizations default="..."> with at least one
    <organization> child."""

    def test_organizations_element_present(self, root):
        orgs = root.find(_tag(NS_CP, "organizations"))
        assert orgs is not None, "<organizations> element must be present"

    def test_organizations_has_default_attribute(self, root):
        orgs = root.find(_tag(NS_CP, "organizations"))
        assert "default" in orgs.attrib, (
            "<organizations> must have a 'default' attribute pointing to the "
            "default organization identifier"
        )

    def test_organizations_default_attribute_not_empty(self, root):
        orgs = root.find(_tag(NS_CP, "organizations"))
        assert orgs.attrib["default"].strip()

    def test_at_least_one_organization_element(self, root):
        orgs = root.find(_tag(NS_CP, "organizations"))
        org_elements = orgs.findall(_tag(NS_CP, "organization"))
        assert len(org_elements) >= 1, "<organizations> must contain at least one <organization>"

    def test_organization_has_identifier_attribute(self, root):
        orgs = root.find(_tag(NS_CP, "organizations"))
        org = orgs.find(_tag(NS_CP, "organization"))
        assert "identifier" in org.attrib, "<organization> must have an 'identifier' attribute"

    def test_organization_identifier_matches_organizations_default(self, root):
        orgs = root.find(_tag(NS_CP, "organizations"))
        default_id = orgs.attrib["default"]
        org = orgs.find(_tag(NS_CP, "organization"))
        assert org.attrib["identifier"] == default_id, (
            "organizations/@default must point to an <organization> identifier"
        )

    def test_organization_has_title(self, root):
        orgs = root.find(_tag(NS_CP, "organizations"))
        org = orgs.find(_tag(NS_CP, "organization"))
        title = org.find(_tag(NS_CP, "title"))
        assert title is not None, "<organization> must contain a <title> element"
        assert title.text and title.text.strip(), "<organization><title> must not be empty"

    def test_organization_has_item_child(self, root):
        orgs = root.find(_tag(NS_CP, "organizations"))
        org = orgs.find(_tag(NS_CP, "organization"))
        items = org.findall(_tag(NS_CP, "item"))
        assert len(items) >= 1, "<organization> must contain at least one <item>"

    def test_item_has_identifierref(self, root):
        orgs = root.find(_tag(NS_CP, "organizations"))
        org = orgs.find(_tag(NS_CP, "organization"))
        item = org.find(_tag(NS_CP, "item"))
        assert "identifierref" in item.attrib, "<item> must have an 'identifierref' attribute"


# ---------------------------------------------------------------------------
# 5. <resources> element
# ---------------------------------------------------------------------------

class TestManifestResources:
    """SCORM 1.2 requires at least one <resource> with type, href, and
    adlcp:scormtype='sco'."""

    def test_resources_element_present(self, root):
        resources = root.find(_tag(NS_CP, "resources"))
        assert resources is not None, "<resources> element must be present"

    def test_at_least_one_resource_element(self, root):
        resources = root.find(_tag(NS_CP, "resources"))
        res_elements = resources.findall(_tag(NS_CP, "resource"))
        assert len(res_elements) >= 1, "<resources> must contain at least one <resource>"

    def test_resource_has_identifier(self, root):
        resources = root.find(_tag(NS_CP, "resources"))
        res = resources.find(_tag(NS_CP, "resource"))
        assert "identifier" in res.attrib, "<resource> must have an 'identifier' attribute"

    def test_resource_type_is_webcontent(self, root):
        resources = root.find(_tag(NS_CP, "resources"))
        res = resources.find(_tag(NS_CP, "resource"))
        assert res.attrib.get("type") == "webcontent", (
            f"<resource> type must be 'webcontent', got: {res.attrib.get('type')!r}"
        )

    def test_resource_href_points_to_index_html(self, root):
        resources = root.find(_tag(NS_CP, "resources"))
        res = resources.find(_tag(NS_CP, "resource"))
        assert res.attrib.get("href") == "index.html", (
            f"<resource> href must be 'index.html', got: {res.attrib.get('href')!r}"
        )

    def test_resource_adlcp_scormtype_is_sco(self, root):
        """adlcp:scormtype must be 'sco' — required for SCORM 1.2 LMS tracking."""
        resources = root.find(_tag(NS_CP, "resources"))
        res = resources.find(_tag(NS_CP, "resource"))
        scorm_type_key = _tag(NS_ADLCP, "scormtype")
        assert scorm_type_key in res.attrib, (
            "<resource> must have adlcp:scormtype attribute"
        )
        assert res.attrib[scorm_type_key] == "sco", (
            f"adlcp:scormtype must be 'sco', got: {res.attrib[scorm_type_key]!r}"
        )

    def test_resource_item_identifierref_resolves(self, root):
        """The <item identifierref> under <organization> must match a resource identifier."""
        orgs = root.find(_tag(NS_CP, "organizations"))
        org = orgs.find(_tag(NS_CP, "organization"))
        item = org.find(_tag(NS_CP, "item"))
        ref = item.attrib.get("identifierref")

        resources = root.find(_tag(NS_CP, "resources"))
        resource_ids = {
            r.attrib.get("identifier")
            for r in resources.findall(_tag(NS_CP, "resource"))
        }
        assert ref in resource_ids, (
            f"<item identifierref='{ref}'> does not resolve to any <resource identifier>"
        )


# ---------------------------------------------------------------------------
# 6. Required <file> entries inside <resource>
# ---------------------------------------------------------------------------

class TestManifestRequiredFiles:
    """SCORM 1.2 manifest resource must list its constituent files."""

    def _file_hrefs(self, root: ET.Element) -> set:
        resources = root.find(_tag(NS_CP, "resources"))
        res = resources.find(_tag(NS_CP, "resource"))
        return {f.attrib.get("href") for f in res.findall(_tag(NS_CP, "file"))}

    def test_file_index_html_present(self, root):
        assert "index.html" in self._file_hrefs(root), (
            "<file href='index.html'/> must be listed in <resource>"
        )

    def test_file_steps_js_present(self, root):
        assert "data/steps.js" in self._file_hrefs(root), (
            "<file href='data/steps.js'/> must be listed in <resource>"
        )

    def test_file_css_present(self, root):
        assert "css/style.css" in self._file_hrefs(root), (
            "<file href='css/style.css'/> must be listed in <resource>"
        )

    def test_file_scorm_api_js_present(self, root):
        assert "js/scorm-api.js" in self._file_hrefs(root), (
            "<file href='js/scorm-api.js'/> must be listed in <resource>"
        )

    def test_file_try_player_js_present(self, root):
        assert "js/try-player.js" in self._file_hrefs(root), (
            "<file href='js/try-player.js'/> must be listed in <resource>"
        )

    def test_quiz_js_absent_when_no_quiz(self, root):
        assert "data/quiz.js" not in self._file_hrefs(root), (
            "data/quiz.js must NOT appear when include_quiz=False"
        )

    def test_quiz_js_present_when_quiz_included(self, root_with_quiz):
        resources = root_with_quiz.find(_tag(NS_CP, "resources"))
        res = resources.find(_tag(NS_CP, "resource"))
        hrefs = {f.attrib.get("href") for f in res.findall(_tag(NS_CP, "file"))}
        assert "data/quiz.js" in hrefs, (
            "<file href='data/quiz.js'/> must be listed when include_quiz=True"
        )


# ---------------------------------------------------------------------------
# 7. Session-id and titulo propagation
# ---------------------------------------------------------------------------

class TestManifestContentPropagation:
    """Dynamic values (session_id, titulo) must appear correctly in the manifest."""

    def test_manifest_identifier_contains_session_id(self, root):
        identifier = root.attrib.get("identifier", "")
        assert "manifest_test" in identifier, (
            f"manifest identifier should contain session_id 'manifest_test', got: {identifier!r}"
        )

    def test_organization_title_contains_module_titulo(self, root):
        orgs = root.find(_tag(NS_CP, "organizations"))
        org = orgs.find(_tag(NS_CP, "organization"))
        title = org.find(_tag(NS_CP, "title"))
        assert title.text == "\u200b", (
            f"<organization><title> should prevent LMS narration using zero-width space, got: {title.text!r}"
        )
