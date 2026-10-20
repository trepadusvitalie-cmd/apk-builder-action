"""Proiect QGIS lângă GDB: straturile din Drum.gdb (căi relative), click pe punct = formularul cu poza
(câmpul „Poza”, widget „Atașament”), poza mică la trecerea cu mouse-ul (Map Tips) și harta OSM dedesubt."""
from xml.sax.saxutils import escape

STIL = {"Copaci": ("40,150,40,255", "circle", 3.2), "Gropi": ("220,40,40,255", "triangle", 3.6),
        "Indicatoare": ("30,90,220,255", "square", 3.4), "OSM_nedetectate": ("120,120,120,255", "cross2", 3.0)}
MAPTIP = ('<b>[% "Categorie" %] [% "Nr" %]</b> [% coalesce("Specie", '') %] · [% "Data" %] · [% "OSM" %]<br>'
          '<img src="file:///[% @project_folder %]/[% "Poza" %]" width="360"><br>'
          '<a href="[% "Google" %]">Google Maps</a> · <a href="[% "StreetView" %]">Street View</a>')
MAPTIP_OSM = '<b>Din OSM, negăsit în filmare:</b> [% "Tip" %] [% "OSM_id" %]<br>[% "Taguri" %]'


def _vector(name, geom, extra):
    lid = f"{name}_drum"
    return lid, f"""
  <maplayer type="vector" geometry="{geom}" autoRefreshEnabled="0">
   <id>{lid}</id>
   <datasource>./Drum.gdb|layername={name}</datasource>
   <layername>{name}</layername>
   <srs><spatialrefsys><authid>EPSG:4026</authid></spatialrefsys></srs>
   <provider encoding="UTF-8">ogr</provider>
   {extra}
  </maplayer>"""


def _puncte(name):
    col, shape, size = STIL[name]
    tip = MAPTIP_OSM if name == "OSM_nedetectate" else MAPTIP
    prev = '"Tip"' if name == "OSM_nedetectate" else '"Categorie" || \' \' || "Nr"'
    lid, xml = _vector(name, "Point", f"""<mapTip enabled="1">{escape(tip)}</mapTip>
   <fieldConfiguration>
    <field name="Poza" configurationFlags="NoFlag">
     <editWidget type="ExternalResource"><config><Option type="Map">
      <Option name="DocumentViewer" type="int" value="1"/>
      <Option name="DocumentViewerHeight" type="int" value="0"/>
      <Option name="DocumentViewerWidth" type="int" value="0"/>
      <Option name="FileWidget" type="bool" value="true"/>
      <Option name="FileWidgetButton" type="bool" value="true"/>
      <Option name="RelativeStorage" type="int" value="1"/>
      <Option name="StorageMode" type="int" value="0"/>
     </Option></config></editWidget>
    </field>
   </fieldConfiguration>
   <renderer-v2 type="singleSymbol" forceraster="0" symbollevels="0" enableorderby="0">
    <symbols>
     <symbol type="marker" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
      <layer class="SimpleMarker" enabled="1" locked="0" pass="0">
       <Option type="Map">
        <Option name="color" type="QString" value="{col}"/>
        <Option name="name" type="QString" value="{shape}"/>
        <Option name="outline_color" type="QString" value="255,255,255,255"/>
        <Option name="outline_width" type="QString" value="0.4"/>
        <Option name="size" type="QString" value="{size}"/>
        <Option name="size_unit" type="QString" value="MM"/>
       </Option>
      </layer>
     </symbol>
    </symbols>
   </renderer-v2>
   <previewExpression>{prev}</previewExpression>""")
    return lid, xml


def scrie(path, extent=None):
    PUNCTE = ("Copaci", "Gropi", "Indicatoare", "OSM_nedetectate")
    layers = [_puncte(n) for n in PUNCTE]
    lid_t, xml_t = _vector("Traseu", "Line", """<renderer-v2 type="singleSymbol" forceraster="0" symbollevels="0" enableorderby="0">
    <symbols><symbol type="line" name="0" alpha="0.8" clip_to_extent="1" force_rhr="0">
     <layer class="SimpleLine" enabled="1" locked="0" pass="0"><Option type="Map">
      <Option name="line_color" type="QString" value="255,140,0,255"/>
      <Option name="line_width" type="QString" value="0.8"/>
      <Option name="line_width_unit" type="QString" value="MM"/>
     </Option></layer></symbol></symbols>
   </renderer-v2>""")
    osm = """
  <maplayer type="raster" autoRefreshEnabled="0">
   <id>OSM_fundal</id>
   <datasource>type=xyz&amp;url=https://tile.openstreetmap.org/{z}/{x}/{y}.png&amp;zmax=19&amp;zmin=0</datasource>
   <layername>OpenStreetMap</layername>
   <srs><spatialrefsys><authid>EPSG:3857</authid></spatialrefsys></srs>
   <provider>wms</provider>
  </maplayer>
  <maplayer type="raster" autoRefreshEnabled="0">
   <id>Satelit_fundal</id>
   <datasource>type=xyz&amp;url=https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}&amp;zmax=19&amp;zmin=0</datasource>
   <layername>Satelit (Esri)</layername>
   <srs><spatialrefsys><authid>EPSG:3857</authid></spatialrefsys></srs>
   <provider>wms</provider>
  </maplayer>"""
    order = [l for l, _ in layers] + [lid_t, "OSM_fundal", "Satelit_fundal"]
    names = list(PUNCTE) + ["Traseu", "OpenStreetMap", "Satelit (Esri)"]
    fundal = ("OpenStreetMap", "Satelit (Esri)")
    tree = "\n".join(
        f'  <layer-tree-layer id="{i}" name="{n}" checked="{"Qt::Unchecked" if n == "Satelit (Esri)" else "Qt::Checked"}" expanded="0" '
        f'providerKey="{"wms" if n in fundal else "ogr"}" source="{"" if n in fundal else "./Drum.gdb|layername=" + n}"/>'
        for i, n in zip(order, names))
    ext = ""
    if extent:
        x0, y0, x1, y1 = extent
        ext = f"""<mapcanvas name="theMapCanvas"><units>meters</units><extent><xmin>{x0}</xmin><ymin>{y0}</ymin><xmax>{x1}</xmax><ymax>{y1}</ymax></extent>
  <destinationsrs><spatialrefsys><authid>EPSG:4026</authid></spatialrefsys></destinationsrs></mapcanvas>"""
    xml = f"""<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="Drum" version="3.34.0-Prizren">
 <homePath path=""/>
 <title>Drum</title>
 <projectCrs><spatialrefsys><authid>EPSG:4026</authid></spatialrefsys></projectCrs>
 <layer-tree-group>
{tree}
 </layer-tree-group>
 {ext}
 <projectlayers>{''.join(x for _, x in layers)}{xml_t}{osm}
 </projectlayers>
 <layerorder>{''.join(f'<layer id="{i}"/>' for i in order)}</layerorder>
 <properties><Paths><Absolute type="bool">false</Absolute></Paths></properties>
</qgis>
"""
    open(path, "w", encoding="utf-8").write(xml)
