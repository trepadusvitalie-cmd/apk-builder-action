"""Scrierea rezultatului ca File Geodatabase (fără ArcGIS, cu GDAL): straturi de puncte cu pozele ca atașamente
(tabelele <strat>__ATTACH + relația de atașament, ca în ArcGIS) și câmpul „Poza” cu calea relativă spre poze/."""
import os
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
ARCGIS = "TARGET_ARCGIS_VERSION=ALL"       # se deschide în ArcMap 10.x și în ArcGIS Pro
STRATURI = [("copac", "Copaci", "Copac"), ("groapa", "Gropi", "Groapă"), ("semn", "Indicatoare", "Indicator")]
CAMPURI = [("Nr", ogr.OFTInteger, 0), ("Categorie", ogr.OFTString, 20), ("Specie", ogr.OFTString, 40), ("Data", ogr.OFTString, 20), ("X", ogr.OFTReal, 0),
           ("Y", ogr.OFTReal, 0), ("Lat", ogr.OFTReal, 0), ("Lon", ogr.OFTReal, 0), ("Incredere", ogr.OFTReal, 0),
           ("Cadre", ogr.OFTInteger, 0), ("Metoda", ogr.OFTString, 60), ("Nota", ogr.OFTString, 200), ("Poza", ogr.OFTString, 120),
           ("OSM", ogr.OFTString, 30), ("OSM_id", ogr.OFTString, 20), ("Dist_OSM", ogr.OFTReal, 0),
           ("Google", ogr.OFTString, 120), ("StreetView", ogr.OFTString, 140)]


def srs():
    s = osr.SpatialReference(); s.ImportFromEPSG(4026); s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER); return s


def scrie(path, objs, traseu, folder, lipsa=()):
    if os.path.exists(path):
        import shutil; shutil.rmtree(path)
    ds = gdal.GetDriverByName("OpenFileGDB").Create(path, 0, 0, 0, gdal.GDT_Unknown)
    sr = srs(); legaturi = []
    for kind, layer, cat in STRATURI:
        lyr = ds.CreateLayer(layer, sr, ogr.wkbPoint, ["FID=OBJECTID", "COLUMN_TYPES=GlobalID=esriFieldTypeGlobalID", ARCGIS])
        for n, t, w in CAMPURI:
            fd = ogr.FieldDefn(n, t)
            if w: fd.SetWidth(w)
            lyr.CreateField(fd)
        lyr.CreateField(ogr.FieldDefn("GlobalID", ogr.OFTString))
        att = ds.CreateLayer(layer + "__ATTACH", None, ogr.wkbNone, ["FID=ATTACHMENTID", "COLUMN_TYPES=REL_GLOBALID=esriFieldTypeGUID", ARCGIS])
        for n, t in [("REL_GLOBALID", ogr.OFTString), ("CONTENT_TYPE", ogr.OFTString), ("ATT_NAME", ogr.OFTString),
                     ("DATA_SIZE", ogr.OFTInteger), ("DATA", ogr.OFTBinary)]:
            att.CreateField(ogr.FieldDefn(n, t))
        for o in [o for o in objs if o["kind"] == kind]:
            f = ogr.Feature(lyr.GetLayerDefn())
            f["Nr"] = o["nr"]; f["Categorie"] = cat; f["Specie"] = o.get("specie_txt", ""); f["Data"] = o["data"]; f["X"] = round(o["E"], 3); f["Y"] = round(o["N"], 3)
            f["Lat"] = round(o["lat"], 7); f["Lon"] = round(o["lon"], 7); f["Incredere"] = round(o["score"], 2)
            f["Cadre"] = o["n"]; f["Metoda"] = o["met"]; f["Poza"] = o["poza"]; f["Nota"] = o.get("nota", "")
            f["OSM"] = o.get("osm", "—"); f["OSM_id"] = o.get("osm_id", "")
            if o.get("osm_dist") is not None: f["Dist_OSM"] = o["osm_dist"]
            f["Google"] = o.get("google", ""); f["StreetView"] = o.get("streetview", "")
            f.SetGeometry(ogr.CreateGeometryFromWkt(f"POINT ({o['E']:.3f} {o['N']:.3f})"))
            lyr.CreateFeature(f)
            gid = lyr.GetFeature(f.GetFID())["GlobalID"]        # GDAL generează GlobalID-ul
            data = open(os.path.join(folder, o["poza"]), "rb").read()
            a = ogr.Feature(att.GetLayerDefn())
            a["REL_GLOBALID"] = gid; a["CONTENT_TYPE"] = "image/jpeg"; a["ATT_NAME"] = os.path.basename(o["poza"])
            a["DATA_SIZE"] = len(data); a.SetFieldBinaryFromHexString("DATA", data.hex())
            att.CreateFeature(a)
        legaturi.append(layer)
    # ce are OpenStreetMap lângă traseu și filmarea n-a găsit (de verificat)
    ol = ds.CreateLayer("OSM_nedetectate", sr, ogr.wkbPoint, ["FID=OBJECTID", ARCGIS])
    for n, w in (("Tip", 20), ("OSM_id", 20), ("Taguri", 254), ("Lat", 0), ("Lon", 0)):
        fd = ogr.FieldDefn(n, ogr.OFTReal if not w else ogr.OFTString)
        if w: fd.SetWidth(w)
        ol.CreateField(fd)
    for s_ in lipsa:
        f = ogr.Feature(ol.GetLayerDefn())
        f["Tip"] = "Copac" if s_["kind"] == "copac" else "Indicator"; f["OSM_id"] = str(s_["id"]); f["Taguri"] = s_["tags"]
        f["Lat"] = round(s_["lat"], 7); f["Lon"] = round(s_["lon"], 7)
        f.SetGeometry(ogr.CreateGeometryFromWkt(f"POINT ({s_['E']:.3f} {s_['N']:.3f})")); ol.CreateFeature(f)
    tl = ds.CreateLayer("Traseu", sr, ogr.wkbLineString, ["FID=OBJECTID", ARCGIS])
    tl.CreateField(ogr.FieldDefn("Lungime_m", ogr.OFTReal))
    line = ogr.Geometry(ogr.wkbLineString)
    for E, N in traseu: line.AddPoint_2D(E, N)
    f = ogr.Feature(tl.GetLayerDefn()); f["Lungime_m"] = round(line.Length(), 1); f.SetGeometry(line); tl.CreateFeature(f)
    ds = None
    # relațiile de atașament se adaugă după ce tabelele sunt scrise pe disc
    ds = gdal.OpenEx(path, gdal.OF_VECTOR | gdal.OF_UPDATE)
    for layer in legaturi:
        r = gdal.Relationship(layer + "__ATTACHREL", layer, layer + "__ATTACH", gdal.GRC_ONE_TO_MANY)
        r.SetLeftTableFields(["GlobalID"]); r.SetRightTableFields(["REL_GLOBALID"])
        r.SetType(gdal.GRT_COMPOSITE); r.SetRelatedTableType("media")
        r.SetForwardPathLabel("attachments"); r.SetBackwardPathLabel("object")
        if not ds.AddRelationship(r): raise RuntimeError("nu s-a putut crea relația de atașament pentru " + layer)
    ds = None
